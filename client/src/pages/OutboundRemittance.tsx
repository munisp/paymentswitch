import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { PieChart, Pie, Cell, LineChart, Line, ResponsiveContainer, Tooltip as RTooltip } from 'recharts';
import {
  LayoutDashboard, ArrowRightLeft, Wallet, Receipt, Globe, Shield, UserPlus,
  Settings, TrendingUp, CheckCircle2, Clock, AlertTriangle, XCircle, Building2,
  Search, Plus, Send, AlertOctagon, ArrowUpCircle, Gavel, RefreshCw,
  DollarSign, BarChart3, Layers, Network, Key, Activity, Code, FileText, Eye, Copy,
  PanelLeftClose, PanelLeft, Moon, Sun, Download, ChevronRight, ArrowUpDown,
  ChevronLeft, ChevronDown, Keyboard, Filter, FileSpreadsheet,
  ShieldAlert, Ban, Scale, AlertCircle, Zap, ToggleLeft, ToggleRight, Trash2,
} from 'lucide-react';

// --- Types ---
type UserRole = 'participant' | 'admin' | 'cbn';
type NavSection = 'dashboard' | 'transfers' | 'prefund' | 'billing' | 'corridors' | 'compliance' | 'disputes' | 'approvals' | 'participants' | 'enforcement' | 'fx_management' | 'tier_management' | 'analytics' | 'payment_rails' | 'developer_portal' | 'transaction_monitoring' | 'settlement' | 'settings' | 'ai_prophet' | 'ai_cocoindex' | 'ai_kgqa' | 'ai_falkordb' | 'ai_ollama' | 'ai_art' | 'ai_gnn' | 'ai_mcmc';

// 13 CBN-regulated corridors (static reference data)
const corridors = [
  { id: 'NG-GH', dest: 'Ghana', currency: 'GHS', category: 'West Africa Labor', spreadCap: 150, maxUsd: 5000 },
  { id: 'NG-SN', dest: 'Senegal', currency: 'XOF', category: 'West Africa Labor', spreadCap: 200, maxUsd: 5000 },
  { id: 'NG-CI', dest: "Côte d'Ivoire", currency: 'XOF', category: 'West Africa Labor', spreadCap: 200, maxUsd: 5000 },
  { id: 'NG-CM', dest: 'Cameroon', currency: 'XAF', category: 'West Africa Labor', spreadCap: 200, maxUsd: 5000 },
  { id: 'NG-GB', dest: 'United Kingdom', currency: 'GBP', category: 'Education', spreadCap: 100, maxUsd: 50000 },
  { id: 'NG-US', dest: 'United States', currency: 'USD', category: 'Education', spreadCap: 100, maxUsd: 50000 },
  { id: 'NG-CA', dest: 'Canada', currency: 'CAD', category: 'Education', spreadCap: 120, maxUsd: 50000 },
  { id: 'NG-IN', dest: 'India', currency: 'INR', category: 'Medical', spreadCap: 150, maxUsd: 30000 },
  { id: 'NG-TR', dest: 'Turkey', currency: 'TRY', category: 'Medical', spreadCap: 175, maxUsd: 30000 },
  { id: 'NG-CN', dest: 'China', currency: 'CNY', category: 'Premium Business', spreadCap: 80, maxUsd: 100000 },
  { id: 'NG-AE', dest: 'UAE', currency: 'AED', category: 'Premium Business', spreadCap: 90, maxUsd: 100000 },
  { id: 'NG-KE', dest: 'Kenya', currency: 'KES', category: 'General Personal', spreadCap: 150, maxUsd: 10000 },
  { id: 'NG-ZA', dest: 'South Africa', currency: 'ZAR', category: 'General Personal', spreadCap: 130, maxUsd: 10000 },
];

function getNavItems(role: UserRole) {
  if (role === 'participant') {
    return [
      { id: 'dashboard' as NavSection, label: 'Dashboard', tKey: 'dashboard', icon: LayoutDashboard },
      { id: 'transfers' as NavSection, label: 'My Transfers', tKey: 'transfers', icon: ArrowRightLeft },
      { id: 'prefund' as NavSection, label: 'My Prefund', tKey: 'prefund', icon: Wallet },
      { id: 'billing' as NavSection, label: 'My Billing', tKey: 'billing', icon: Receipt },
      { id: 'disputes' as NavSection, label: 'My Disputes', tKey: 'disputes', icon: AlertOctagon },
      { id: 'corridors' as NavSection, label: 'Corridors', tKey: 'corridors', icon: Globe },
      { id: 'compliance' as NavSection, label: 'My Compliance', tKey: 'compliance', icon: Shield },
      { id: 'developer_portal' as NavSection, label: 'API Portal', tKey: 'devPortal', icon: Code },
      { id: 'transaction_monitoring' as NavSection, label: 'Live Tracking', tKey: 'liveMonitor', icon: Activity },
      { id: 'settings' as NavSection, label: 'Settings', tKey: 'settings', icon: Settings },
      // Intelligence
      { id: 'ai_prophet' as NavSection, label: 'Volume Forecasting', tKey: '', icon: TrendingUp },
      { id: 'ai_cocoindex' as NavSection, label: 'Data Pipeline', tKey: '', icon: Layers },
      { id: 'ai_kgqa' as NavSection, label: 'Knowledge Search', tKey: '', icon: Search },
      { id: 'ai_falkordb' as NavSection, label: 'Graph Analytics', tKey: '', icon: Network },
      { id: 'ai_ollama' as NavSection, label: 'AI Assistant', tKey: '', icon: Zap },
      { id: 'ai_art' as NavSection, label: 'Model Security', tKey: '', icon: ShieldAlert },
      { id: 'ai_gnn' as NavSection, label: 'Fraud Networks', tKey: '', icon: Network },
      { id: 'ai_mcmc' as NavSection, label: 'Risk Scoring', tKey: '', icon: Activity },
    ];
  }
  return [
    { id: 'dashboard' as NavSection, label: 'Dashboard', tKey: 'dashboard', icon: LayoutDashboard },
    { id: 'approvals' as NavSection, label: 'Approvals', tKey: 'approvals', icon: Gavel },
    { id: 'transfers' as NavSection, label: 'All Transfers', tKey: 'transfers', icon: ArrowRightLeft },
    { id: 'participants' as NavSection, label: 'Participants', tKey: 'participants', icon: Building2 },
    { id: 'enforcement' as NavSection, label: 'Enforcement', tKey: 'enforcement', icon: ShieldAlert },
    { id: 'prefund' as NavSection, label: 'Prefund Accounts', tKey: 'prefund', icon: Wallet },
    { id: 'disputes' as NavSection, label: 'All Disputes', tKey: 'disputes', icon: AlertOctagon },
    { id: 'compliance' as NavSection, label: 'Compliance', tKey: 'compliance', icon: Shield },
    { id: 'corridors' as NavSection, label: 'Corridors', tKey: 'corridors', icon: Globe },
    { id: 'fx_management' as NavSection, label: 'FX & Rates', tKey: 'fxRates', icon: DollarSign },
    { id: 'tier_management' as NavSection, label: 'Tier Management', tKey: 'tierMgmt', icon: Layers },
    { id: 'payment_rails' as NavSection, label: 'Payment Rails', tKey: 'paymentRails', icon: Network },
    { id: 'analytics' as NavSection, label: 'Analytics', tKey: 'analytics', icon: BarChart3 },
    { id: 'developer_portal' as NavSection, label: 'API Portal', tKey: 'devPortal', icon: Code },
    { id: 'transaction_monitoring' as NavSection, label: 'Live Monitoring', tKey: 'liveMonitor', icon: Activity },
    { id: 'settlement' as NavSection, label: 'Settlement', tKey: 'settlement', icon: Layers },
    { id: 'billing' as NavSection, label: 'Billing', tKey: 'billing', icon: Receipt },
    { id: 'settings' as NavSection, label: 'Settings', tKey: 'settings', icon: Settings },
    // Intelligence
    { id: 'ai_prophet' as NavSection, label: 'Volume Forecasting', tKey: '', icon: TrendingUp },
    { id: 'ai_cocoindex' as NavSection, label: 'Data Pipeline', tKey: '', icon: Layers },
    { id: 'ai_kgqa' as NavSection, label: 'Knowledge Search', tKey: '', icon: Search },
    { id: 'ai_falkordb' as NavSection, label: 'Graph Analytics', tKey: '', icon: Network },
    { id: 'ai_ollama' as NavSection, label: 'AI Assistant', tKey: '', icon: Zap },
    { id: 'ai_art' as NavSection, label: 'Model Security', tKey: '', icon: ShieldAlert },
    { id: 'ai_gnn' as NavSection, label: 'Fraud Networks', tKey: '', icon: Network },
    { id: 'ai_mcmc' as NavSection, label: 'Risk Scoring', tKey: '', icon: Activity },
  ];
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    completed: 'default', active: 'default', clear: 'default', paid: 'default', approved: 'default', resolved: 'default',
    routing: 'secondary', admitted: 'secondary', pending: 'secondary', pending_approval: 'secondary', pending_review: 'secondary', under_review: 'secondary', open: 'secondary',
    manual_review: 'outline', escalated: 'outline',
    failed: 'destructive', blocked: 'destructive', rejected: 'destructive', critical: 'destructive',
  };
  return <Badge variant={variants[status] || 'outline'}>{status.replace(/_/g, ' ')}</Badge>;
}

function formatNgn(amount: string | number) {
  return `₦${Number(amount).toLocaleString()}`;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

// --- Dark mode hook ---
function useDarkMode() {
  const [dark, setDark] = useState(() => {
    if (typeof window !== 'undefined') return document.documentElement.classList.contains('dark');
    return false;
  });
  const toggle = useCallback(() => {
    setDark(d => {
      const next = !d;
      document.documentElement.classList.toggle('dark', next);
      localStorage.setItem('theme', next ? 'dark' : 'light');
      return next;
    });
  }, []);
  useEffect(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark') { document.documentElement.classList.add('dark'); setDark(true); }
  }, []);
  return { dark, toggle };
}

// --- Relative time ---
function relativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// --- i18n (#18) ---
type Locale = 'en' | 'fr' | 'ar';
const translations: Record<Locale, Record<string, string>> = {
  en: { dashboard: 'Dashboard', approvals: 'Approvals', transfers: 'All Transfers', participants: 'Participants', enforcement: 'Enforcement', prefund: 'Prefund Accounts', disputes: 'All Disputes', compliance: 'Compliance', corridors: 'Corridors', fxRates: 'FX & Rates', tierMgmt: 'Tier Mgmt', paymentRails: 'Payment Rails', analytics: 'Analytics', devPortal: 'Developer Portal', liveMonitor: 'Live Monitoring', settlement: 'Settlement', billing: 'Billing', settings: 'Settings', search: 'Search...', export: 'Export', totalTransfers: 'Total Transfers', successRate: 'Success Rate', prefundBalance: 'Prefund Balance', pendingApprovals: 'Pending Approvals' },
  fr: { dashboard: 'Tableau de Bord', approvals: 'Approbations', transfers: 'Tous les Transferts', participants: 'Participants', enforcement: 'Application', prefund: 'Comptes de Préfinancement', disputes: 'Tous les Litiges', compliance: 'Conformité', corridors: 'Corridors', fxRates: 'FX & Taux', tierMgmt: 'Gestion des Niveaux', paymentRails: 'Rails de Paiement', analytics: 'Analytique', devPortal: 'Portail Développeur', liveMonitor: 'Suivi en Direct', settlement: 'Règlement', billing: 'Facturation', settings: 'Paramètres', search: 'Rechercher...', export: 'Exporter', totalTransfers: 'Total des Transferts', successRate: 'Taux de Réussite', prefundBalance: 'Solde de Préfinancement', pendingApprovals: 'Approbations en Attente' },
  ar: { dashboard: 'لوحة المعلومات', approvals: 'الموافقات', transfers: 'جميع التحويلات', participants: 'المشاركون', enforcement: 'الإنفاذ', prefund: 'حسابات التمويل المسبق', disputes: 'جميع النزاعات', compliance: 'الامتثال', corridors: 'الممرات', fxRates: 'أسعار الصرف', tierMgmt: 'إدارة المستويات', paymentRails: 'مسارات الدفع', analytics: 'التحليلات', devPortal: 'بوابة المطورين', liveMonitor: 'المراقبة المباشرة', settlement: 'التسوية', billing: 'الفوترة', settings: 'الإعدادات', search: '...بحث', export: 'تصدير', totalTransfers: 'إجمالي التحويلات', successRate: 'معدل النجاح', prefundBalance: 'رصيد التمويل المسبق', pendingApprovals: 'الموافقات المعلقة' },
};
function useLocale(): { locale: Locale; t: (key: string) => string; setLocale: (l: Locale) => void } {
  const [locale, setLocale] = useState<Locale>(() => (localStorage.getItem('locale') as Locale) || 'en');
  const t = useCallback((key: string) => translations[locale]?.[key] ?? key, [locale]);
  const set = useCallback((l: Locale) => { setLocale(l); localStorage.setItem('locale', l); }, []);
  return { locale, t, setLocale: set };
}

// --- Loading skeleton ---
function TableSkeleton({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <Table>
      <TableHeader><TableRow>{Array.from({ length: cols }).map((_, i) => <TableHead key={i}><Skeleton className="h-4 w-20" /></TableHead>)}</TableRow></TableHeader>
      <TableBody>
        {Array.from({ length: rows }).map((_, r) => (
          <TableRow key={r}>{Array.from({ length: cols }).map((_, c) => <TableCell key={c}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// --- Animated counter ---
function AnimatedCounter({ value, prefix = '', suffix = '' }: { value: number; prefix?: string; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const dur = 800;
    const start = performance.now();
    const from = display;
    const step = (now: number) => {
      const t = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [value]);
  return <span>{prefix}{display.toLocaleString()}{suffix}</span>;
}

// --- Sparkline ---
function Sparkline({ data, color = '#3b82f6' }: { data: number[]; color?: string }) {
  const chartData = data.map((v, i) => ({ v, i }));
  return (
    <ResponsiveContainer width="100%" height={30}>
      <LineChart data={chartData}><Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} /></LineChart>
    </ResponsiveContainer>
  );
}

// --- Mini donut ---
const DONUT_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];
function MiniDonut({ data }: { data: { name: string; value: number }[] }) {
  return (
    <ResponsiveContainer width={80} height={80}>
      <PieChart>
        <Pie data={data} cx="50%" cy="50%" innerRadius={22} outerRadius={35} dataKey="value" strokeWidth={0}>
          {data.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
        </Pie>
        <RTooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}

// --- Sortable header ---
function SortableHeader({ label, sortKey, currentSort, onSort }: { label: string; sortKey: string; currentSort: { key: string; dir: 'asc' | 'desc' } | null; onSort: (key: string) => void }) {
  const active = currentSort?.key === sortKey;
  return (
    <TableHead className="cursor-pointer select-none hover:bg-accent/50" onClick={() => onSort(sortKey)}>
      <div className="flex items-center gap-1">
        {label}
        <ArrowUpDown className={`h-3 w-3 ${active ? 'text-foreground' : 'text-muted-foreground/50'}`} />
      </div>
    </TableHead>
  );
}

// --- Export helper ---
function exportTableToCSV(headers: string[], rows: string[][], filename: string) {
  const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  toast.success(`Exported ${rows.length} rows to ${filename}`);
}

export default function OutboundRemittance() {
  const [activeSection, setActiveSection] = useState<NavSection>(() => {
    const hash = window.location.hash.replace('#', '') as NavSection;
    return hash || 'dashboard';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { dark, toggle: toggleDark } = useDarkMode();
  const { locale, t, setLocale } = useLocale();

  const { data: authContext, isLoading: loadingAuth, error: authError } = trpc.outboundRemittance.getMyContext.useQuery(
    undefined, { retry: 1, retryDelay: 1000 }
  );
  const userRole: UserRole = authContext?.role ?? 'participant';
  const navItems = getNavItems(userRole);
  const isAdmin = userRole === 'admin' || userRole === 'cbn';

  // URL hash sync for tab persistence (#5)
  useEffect(() => {
    window.location.hash = activeSection;
  }, [activeSection]);

  // Global keyboard shortcut for command palette (#3)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCmdOpen(true); }
      if (e.key === '?' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) { e.preventDefault(); setShortcutsOpen(true); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Loading skeleton (#15)
  if (loadingAuth && !authError) {
    return (
      <div className="min-h-screen bg-background flex">
        <aside className="w-64 border-r bg-card flex flex-col">
          <div className="p-4 border-b"><Skeleton className="h-10 w-full" /></div>
          <div className="p-4 border-b"><Skeleton className="h-12 w-full" /></div>
          <div className="p-2 space-y-2 flex-1">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        </aside>
        <main className="flex-1 p-6">
          <Skeleton className="h-8 w-64 mb-4" />
          <div className="grid grid-cols-4 gap-4 mb-6">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
          <Skeleton className="h-64 w-full" />
        </main>
      </div>
    );
  }

  return (
    <TooltipProvider>
    <div className="min-h-screen bg-background flex">
      {/* Command Palette (#3) */}
      <CommandDialog open={cmdOpen} onOpenChange={setCmdOpen}>
        <CommandInput placeholder="Search sections, transfers, participants..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Sections">
            {navItems.map(item => (
              <CommandItem key={item.id} onSelect={() => { setActiveSection(item.id); setCmdOpen(false); }}>
                <item.icon className="mr-2 h-4 w-4" />
                {item.tKey ? t(item.tKey) : item.label}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Actions">
            <CommandItem onSelect={() => { toggleDark(); setCmdOpen(false); }}>
              {dark ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
              Toggle {dark ? 'Light' : 'Dark'} Mode
            </CommandItem>
            <CommandItem onSelect={() => { setSidebarCollapsed(c => !c); setCmdOpen(false); }}>
              <PanelLeft className="mr-2 h-4 w-4" />
              Toggle Sidebar
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      {/* Keyboard Shortcuts Dialog (#17) */}
      {shortcutsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShortcutsOpen(false)}>
          <div className="bg-card border rounded-lg shadow-xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold flex items-center gap-2"><Keyboard className="h-4 w-4" /> Keyboard Shortcuts</h3>
              <Button variant="ghost" size="sm" onClick={() => setShortcutsOpen(false)}>×</Button>
            </div>
            <div className="space-y-2 text-sm">
              {[
                ['Ctrl+K', 'Open command palette'],
                ['?', 'Show this help'],
                ['Esc', 'Close dialogs'],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{desc}</span>
                  <kbd className="px-2 py-0.5 bg-muted rounded text-xs font-mono">{key}</kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Collapsible Sidebar (#1) */}
      <aside className={`${sidebarCollapsed ? 'w-16' : 'w-64'} border-r bg-card flex flex-col transition-all duration-200`}>
        <div className="p-3 border-b flex items-center justify-between">
          <div className={`flex items-center gap-2 ${sidebarCollapsed ? 'justify-center w-full' : ''}`}>
            <Globe className="h-5 w-5 text-blue-600 shrink-0" />
            {!sidebarCollapsed && (
              <div>
                <h2 className="font-semibold text-sm">Outbound Remittance</h2>
                <p className="text-xs text-muted-foreground">Payment Switch Module</p>
              </div>
            )}
          </div>
          {!sidebarCollapsed && (
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setSidebarCollapsed(true)}>
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          )}
        </div>
        {!sidebarCollapsed && (
          <div className="p-4 border-b">
            <p className="text-xs text-muted-foreground">{isAdmin ? 'Platform Admin' : 'Your Account'}</p>
            <p className="font-medium text-sm">{authContext?.participantName ?? (isAdmin ? 'CBN / Admin' : 'Participant')}</p>
            <div className="flex items-center gap-2 mt-1">
              {authContext?.tier && <Badge variant="outline" className="text-xs">{authContext.tier} Tier</Badge>}
              <Badge className="text-xs bg-green-600">Connected</Badge>
            </div>
          </div>
        )}
        {!sidebarCollapsed && (
          <div className="p-3 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search... (Ctrl+K)"
                className="pl-8 h-8 text-xs"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && searchQuery.length >= 2) setActiveSection('transfers'); }}
                onFocus={() => setCmdOpen(true)}
              />
            </div>
          </div>
        )}
        <nav className={`flex-1 ${sidebarCollapsed ? 'p-1' : 'p-2'} space-y-0.5 overflow-y-auto`}>
          {navItems.filter(n => !n.id.startsWith('ai_')).map((item) => (
            <Tooltip key={item.id} delayDuration={sidebarCollapsed ? 0 : 999999}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setActiveSection(item.id)}
                  className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center px-2' : 'gap-2 px-3'} py-2 text-sm rounded-md transition-colors ${activeSection === item.id ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!sidebarCollapsed && (item.tKey ? t(item.tKey) : item.label)}
                </button>
              </TooltipTrigger>
              {sidebarCollapsed && <TooltipContent side="right">{item.tKey ? t(item.tKey) : item.label}</TooltipContent>}
            </Tooltip>
          ))}
          {!sidebarCollapsed && <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-3 pt-3 pb-1">Intelligence</div>}
          {navItems.filter(n => n.id.startsWith('ai_')).map((item) => (
            <Tooltip key={item.id} delayDuration={sidebarCollapsed ? 0 : 999999}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setActiveSection(item.id)}
                  className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center px-2' : 'gap-2 px-3'} py-2 text-sm rounded-md transition-colors ${activeSection === item.id ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!sidebarCollapsed && (item.tKey ? t(item.tKey) : item.label)}
                </button>
              </TooltipTrigger>
              {sidebarCollapsed && <TooltipContent side="right">{item.tKey ? t(item.tKey) : item.label}</TooltipContent>}
            </Tooltip>
          ))}
        </nav>
        {!sidebarCollapsed && userRole !== 'participant' && (
          <div className="px-2 pb-2 border-t pt-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-1">Payment Switch Modules</p>
            {[
              { label: 'Inbound Remittance', href: '/inbound-remittance', color: '#059669' },
              { label: 'Domestic Payments', href: '/domestic-payments', color: '#2563eb' },
              { label: 'Trade Payments', href: '/trade-payments', color: '#7c3aed' },
              { label: 'Card Processing', href: '/card-processing', color: '#dc2626' },
              { label: 'Government Payments', href: '/government-payments', color: '#0369a1' },
              { label: 'Open Banking', href: '/open-banking', color: '#0ea5e9' },
            ].map(m => (
              <a key={m.href} href={m.href} className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-md hover:bg-accent transition-colors" style={{ color: m.color }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.color }} />
                {m.label}
              </a>
            ))}
          </div>
        )}
        <div className={`border-t ${sidebarCollapsed ? 'p-1' : 'p-3'}`}>
          <div className={`flex ${sidebarCollapsed ? 'flex-col items-center gap-1' : 'items-center justify-between'}`}>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={toggleDark}>
                  {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side={sidebarCollapsed ? 'right' : 'top'}>Toggle {dark ? 'Light' : 'Dark'} Mode</TooltipContent>
            </Tooltip>
            {sidebarCollapsed && (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setSidebarCollapsed(false)}>
                    <PanelLeft className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Expand Sidebar</TooltipContent>
              </Tooltip>
            )}
            {!sidebarCollapsed && (
              <div className="text-xs text-muted-foreground">
                <p>Role: {userRole}</p>
                <p className="mt-0.5">API v2.1 • Switch v4.2</p>
                <div className="flex gap-1 mt-1">
                  {(['en', 'fr', 'ar'] as Locale[]).map(l => (
                    <button key={l} onClick={() => setLocale(l)} className={`px-1.5 py-0.5 rounded text-[10px] ${locale === l ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}>
                      {l.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 overflow-auto">
        {/* Breadcrumb (#2) */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-4">
          <span className="cursor-pointer hover:text-foreground" onClick={() => setActiveSection('dashboard')}>Home</span>
          <ChevronRight className="h-3 w-3" />
          <span className="text-foreground font-medium">{(() => { const nav = navItems.find(n => n.id === activeSection); return nav?.tKey ? t(nav.tKey) : nav?.label ?? activeSection; })()}</span>
        </div>
        {activeSection === 'dashboard' && <DashboardSection role={userRole} />}
        {activeSection === 'transfers' && <TransfersSection role={userRole} search={searchQuery} />}
        {activeSection === 'prefund' && <PrefundSection role={userRole} />}
        {activeSection === 'billing' && <BillingSection role={userRole} />}
        {activeSection === 'corridors' && <CorridorsSection />}
        {activeSection === 'compliance' && <ComplianceSection role={userRole} />}
        {activeSection === 'disputes' && <DisputesSection role={userRole} />}
        {activeSection === 'approvals' && <ApprovalsSection role={userRole} />}
        {activeSection === 'participants' && <ParticipantsSection role={userRole} />}
        {activeSection === 'enforcement' && <EnforcementSection role={userRole} />}
        {activeSection === 'fx_management' && <FXManagementSection />}
        {activeSection === 'tier_management' && <TierManagementSection />}
        {activeSection === 'analytics' && <AnalyticsSection />}
        {activeSection === 'payment_rails' && <PaymentRailsSection isAdmin={isAdmin} />}
        {activeSection === 'developer_portal' && <DeveloperPortalSection role={userRole} />}
        {activeSection === 'transaction_monitoring' && <TransactionMonitoringSection role={userRole} />}
        {activeSection === 'settlement' && <SettlementSection />}
        {activeSection === 'settings' && <SettingsSection role={userRole} />}
        {activeSection?.startsWith('ai_') && <OutboundAIMLSection activeTab={activeSection} />}
      </main>
    </div>
    </TooltipProvider>
  );
}

// =============================================================================
// OUTBOUND AI/ML SECTION
// =============================================================================

function SourceBanner({ source }: { source: string }) {
  const isLive = source.includes('LIVE');
  return (
    <div className={`mb-4 p-3 rounded-md border text-sm ${isLive ? 'bg-green-50 border-green-300 text-green-800 dark:bg-green-950 dark:border-green-700 dark:text-green-300' : 'bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-300'}`}>
      {source}
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="border rounded-lg p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold mt-1">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function OutboundAIMLSection({ activeTab }: { activeTab: string }) {
  const prophetQ = trpc.outboundRemittance.getOutboundProphetPipeline.useQuery(undefined, { enabled: activeTab === 'ai_prophet' });
  const cocoQ = trpc.outboundRemittance.getOutboundCocoIndex.useQuery(undefined, { enabled: activeTab === 'ai_cocoindex' });
  const kgqaQ = trpc.outboundRemittance.getOutboundEPRKGQA.useQuery(undefined, { enabled: activeTab === 'ai_kgqa' });
  const falkorQ = trpc.outboundRemittance.getOutboundFalkorDB.useQuery(undefined, { enabled: activeTab === 'ai_falkordb' });
  const ollamaQ = trpc.outboundRemittance.getOutboundOllamaStatus.useQuery(undefined, { enabled: activeTab === 'ai_ollama' });
  const ollamaMut = trpc.outboundRemittance.queryOutboundOllama.useMutation();
  const artQ = trpc.outboundRemittance.getOutboundARTResults.useQuery(undefined, { enabled: activeTab === 'ai_art' });
  const gnnQ = trpc.outboundRemittance.getOutboundGNNFraudNetworks.useQuery(undefined, { enabled: activeTab === 'ai_gnn' });
  const mcmcQ = trpc.outboundRemittance.getOutboundMCMCFraudScoring.useQuery(undefined, { enabled: activeTab === 'ai_mcmc' });
  const [ollamaInput, setOllamaInput] = React.useState('');
  const [ollamaHistory, setOllamaHistory] = React.useState<{q:string;a:string}[]>([]);

  if (activeTab === 'ai_prophet') {
    const d = prophetQ.data as any;
    if (prophetQ.isLoading) return <Skeleton className="h-64 w-full" />;
    if (!d) return <p className="text-muted-foreground">No Prophet data available</p>;
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Prophet Forecasting Pipeline — Outbound Remittance</h2>
        <SourceBanner source={d._source} />
        <div className="grid grid-cols-4 gap-4">
          <MetricCard label="Model" value={d.model.id} sub={d.model.framework} />
          <MetricCard label="MAPE" value={`${d.metrics.mape.toFixed(2)}%`} sub={`Confidence: ${d.metrics.confidenceScore.toFixed(1)}%`} />
          <MetricCard label="RMSE" value={d.metrics.rmse.toLocaleString()} sub={`MAE: ${d.metrics.mae.toLocaleString()}`} />
          <MetricCard label="CV Folds" value={d.metrics.crossValidationFolds} sub={`R²: ${d.metrics.rSquared.toFixed(4)}`} />
        </div>
        <div className="border rounded-lg p-4">
          <h3 className="font-medium mb-2">Cross-Validation Results</h3>
          <table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th className="pb-1">Fold</th><th>MAPE</th><th>RMSE</th><th>R²</th></tr></thead>
          <tbody>{d.crossValidation.map((cv: any) => <tr key={cv.fold}><td className="py-1">Fold {cv.fold}</td><td>{cv.mape.toFixed(2)}%</td><td>{cv.rmse.toLocaleString()}</td><td>{cv.rSquared.toFixed(4)}</td></tr>)}</tbody></table>
        </div>
        <div className="border rounded-lg p-4">
          <h3 className="font-medium mb-2">Nigerian Regressors</h3>
          <table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th className="pb-1">Regressor</th><th>Description</th><th>Weight</th><th>Active</th></tr></thead>
          <tbody>{d.regressors.map((r: any) => <tr key={r.name}><td className="py-1 font-mono text-xs">{r.name}</td><td>{r.description}</td><td>{r.weight.toFixed(2)}</td><td>{r.active ? '✓' : '✗'}</td></tr>)}</tbody></table>
        </div>
        <div className="border rounded-lg p-4">
          <h3 className="font-medium mb-2">Forecast (7-Day Horizon)</h3>
          <table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th className="pb-1">Date</th><th>Corridor</th><th>Predicted (₦)</th><th>Lower</th><th>Upper</th><th>Tags</th></tr></thead>
          <tbody>{d.forecasts.map((f: any, i: number) => <tr key={i}><td className="py-1">{f.date}</td><td>{f.corridor}</td><td className="font-medium">₦{f.predicted.toLocaleString()}</td><td>₦{f.lower.toLocaleString()}</td><td>₦{f.upper.toLocaleString()}</td><td>{f.isSalaryDay ? <span className="text-xs bg-blue-100 dark:bg-blue-900 px-1 rounded">SALARY DAY</span> : ''}{f.isHoliday ? <span className="text-xs bg-red-100 dark:bg-red-900 px-1 rounded ml-1">HOLIDAY</span> : ''}</td></tr>)}</tbody></table>
        </div>
      </div>
    );
  }

  if (activeTab === 'ai_cocoindex') {
    const d = cocoQ.data as any;
    if (cocoQ.isLoading) return <Skeleton className="h-64 w-full" />;
    if (!d) return <p className="text-muted-foreground">No CocoIndex data</p>;
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">CocoIndex Data Pipeline — Outbound Remittance</h2>
        <div className="grid grid-cols-4 gap-4">
          <MetricCard label="Pipeline" value={d.pipeline.name} sub={d.pipeline.framework} />
          <MetricCard label="Total Docs" value={d.stats.totalDocs.toLocaleString()} sub={`${d.stats.indexingRate.toLocaleString()} docs/s`} />
          <MetricCard label="Avg Latency" value={`${d.stats.avgLatencyMs}ms`} sub={`Cache hit: ${(d.stats.cacheHitRate * 100).toFixed(0)}%`} />
          <MetricCard label="Status" value={d.pipeline.status} sub={d.pipeline.version} />
        </div>
        <div className="border rounded-lg p-4">
          <h3 className="font-medium mb-2">Data Sources</h3>
          <table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th className="pb-1">Source</th><th>Type</th><th>Status</th><th>Docs Indexed</th><th>Lag</th></tr></thead>
          <tbody>{d.sources.map((s: any) => <tr key={s.name}><td className="py-1">{s.name}</td><td>{s.type}</td><td><span className={`text-xs px-1 rounded ${s.status === 'streaming' ? 'bg-green-100 dark:bg-green-900' : 'bg-blue-100 dark:bg-blue-900'}`}>{s.status}</span></td><td>{s.docsIndexed.toLocaleString()}</td><td>{s.lag}</td></tr>)}</tbody></table>
        </div>
        <div className="border rounded-lg p-4">
          <h3 className="font-medium mb-2">Middleware Integration</h3>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div><span className="text-muted-foreground">Kafka:</span> {d.middleware.kafka}</div>
            <div><span className="text-muted-foreground">Fluvio:</span> {d.middleware.fluvio}</div>
            <div><span className="text-muted-foreground">Redis:</span> {d.middleware.redis}</div>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'ai_kgqa') {
    const d = kgqaQ.data as any;
    if (kgqaQ.isLoading) return <Skeleton className="h-64 w-full" />;
    if (!d) return <p className="text-muted-foreground">No KGQA data</p>;
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">EPR-KGQA — Knowledge Graph QA (Outbound)</h2>
        <div className="grid grid-cols-4 gap-4">
          <MetricCard label="Nodes" value={d.graph.nodes.toLocaleString()} sub={d.graph.nodeTypes.join(', ')} />
          <MetricCard label="Edges" value={d.graph.edges.toLocaleString()} sub={d.graph.edgeTypes.join(', ')} />
          <MetricCard label="Total Queries" value={d.stats.totalQueries.toLocaleString()} sub={`Cache: ${(d.stats.cacheHitRate * 100).toFixed(0)}%`} />
          <MetricCard label="Avg Latency" value={`${d.stats.avgLatencyMs}ms`} sub={d.graph.framework} />
        </div>
        <div className="border rounded-lg p-4">
          <h3 className="font-medium mb-2">Recent KG Queries</h3>
          {d.recentQueries.map((q: any, i: number) => (
            <div key={i} className="mb-3 border-b last:border-0 pb-3">
              <p className="font-medium text-sm">{q.question}</p>
              <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto">{q.cypher}</pre>
              <p className="text-sm mt-1">{q.answer}</p>
              <p className="text-xs text-muted-foreground mt-1">{q.latencyMs}ms • {q.tokens} tokens</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (activeTab === 'ai_falkordb') {
    const d = falkorQ.data as any;
    if (falkorQ.isLoading) return <Skeleton className="h-64 w-full" />;
    if (!d) return <p className="text-muted-foreground">No FalkorDB data</p>;
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">FalkorDB Graph Engine — Outbound Remittance</h2>
        <div className="grid grid-cols-4 gap-4">
          <MetricCard label="Nodes" value={d.stats.totalNodes.toLocaleString()} sub={`${d.stats.totalEdges.toLocaleString()} edges`} />
          <MetricCard label="Avg Query" value={`${d.stats.avgQueryMs}ms`} sub={`${d.stats.queriesPerSec.toLocaleString()} QPS`} />
          <MetricCard label="Cache Hit" value={`${(d.stats.cacheHitRate * 100).toFixed(0)}%`} sub={`Memory: ${d.stats.memoryMb}MB`} />
          <MetricCard label="Status" value={d.connection.status} sub={d.connection.graphName} />
        </div>
        <div className="border rounded-lg p-4">
          <h3 className="font-medium mb-2">Corridor Graph</h3>
          <table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th className="pb-1">Corridor</th><th>Nodes</th><th>Edges</th><th>Avg Degree</th><th>Risk Score</th></tr></thead>
          <tbody>{d.corridorGraph.map((c: any) => <tr key={c.corridor}><td className="py-1 font-mono">{c.corridor}</td><td>{c.nodes.toLocaleString()}</td><td>{c.edges.toLocaleString()}</td><td>{c.avgDegree}</td><td><span className={`text-xs px-1 rounded ${c.riskScore > 0.15 ? 'bg-red-100 dark:bg-red-900' : 'bg-green-100 dark:bg-green-900'}`}>{c.riskScore}</span></td></tr>)}</tbody></table>
        </div>
        <div className="border rounded-lg p-4">
          <h3 className="font-medium mb-2">Recent Queries</h3>
          {d.recentQueries.map((q: any, i: number) => (
            <div key={i} className="mb-2 border-b last:border-0 pb-2">
              <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">{q.query}</pre>
              <p className="text-sm mt-1">Result: {q.result} <span className="text-muted-foreground">({q.latencyUs}μs)</span></p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (activeTab === 'ai_ollama') {
    const d = ollamaQ.data as any;
    if (ollamaQ.isLoading) return <Skeleton className="h-64 w-full" />;
    if (!d) return <p className="text-muted-foreground">No Ollama data</p>;
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Ollama LLM — Outbound Remittance</h2>
        <SourceBanner source={d._source} />
        <div className="grid grid-cols-4 gap-4">
          <MetricCard label="Model" value={d.config.model} sub={d.config.framework} />
          <MetricCard label="Total Queries" value={d.stats.totalQueries} sub={`Avg: ${d.stats.avgLatencyMs}ms`} />
          <MetricCard label="Tokens Used" value={d.stats.totalTokensUsed.toLocaleString()} sub={`Uptime: ${d.stats.uptimeHours}h`} />
          <MetricCard label="Model Size" value={`${d.stats.modelSizeGb}GB`} sub={`Max Tokens: ${d.config.maxTokens}`} />
        </div>
        <div className="border rounded-lg p-4">
          <h3 className="font-medium mb-2">Interactive Query</h3>
          <div className="flex gap-2">
            <input className="flex-1 border rounded px-3 py-2 text-sm" placeholder="Ask about outbound remittance..." value={ollamaInput} onChange={e => setOllamaInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && ollamaInput.trim()) { const q = ollamaInput.trim(); setOllamaInput(''); ollamaMut.mutate({ question: q }, { onSuccess: (r: any) => setOllamaHistory(h => [...h, { q, a: r.answer }]) }); } }} />
            <Button size="sm" disabled={ollamaMut.isPending || !ollamaInput.trim()} onClick={() => { const q = ollamaInput.trim(); setOllamaInput(''); ollamaMut.mutate({ question: q }, { onSuccess: (r: any) => setOllamaHistory(h => [...h, { q, a: r.answer }]) }); }}>
              {ollamaMut.isPending ? 'Thinking...' : 'Ask'}
            </Button>
          </div>
          {ollamaHistory.map((h, i) => (
            <div key={i} className="mt-3 border-t pt-2">
              <p className="text-sm font-medium">Q: {h.q}</p>
              <p className="text-sm mt-1 whitespace-pre-wrap">{h.a}</p>
            </div>
          ))}
        </div>
        <div className="border rounded-lg p-4">
          <h3 className="font-medium mb-2">Recent Queries</h3>
          {d.recentQueries.map((q: any, i: number) => (
            <div key={i} className="mb-2 border-b last:border-0 pb-2">
              <p className="text-sm font-medium">{q.question}</p>
              <p className="text-sm mt-1">{q.answer}</p>
              <p className="text-xs text-muted-foreground mt-1">{q.latencyMs}ms • {q.tokens} tokens • {q.category}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (activeTab === 'ai_art') {
    const d = artQ.data as any;
    if (artQ.isLoading) return <Skeleton className="h-64 w-full" />;
    if (!d) return <p className="text-muted-foreground">No ART data</p>;
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">IBM ART Robustness — Outbound Remittance</h2>
        <SourceBanner source={d._source} />
        <div className="grid grid-cols-4 gap-4">
          <MetricCard label="Model" value={d.model.name} sub={d.model.framework} />
          <MetricCard label="Clean Accuracy" value={`${(d.model.accuracy * 100).toFixed(1)}%`} sub={`${d.model.trainingSamples} training samples`} />
          <MetricCard label="Robustness" value={`${(d.model.robustness * 100).toFixed(1)}%`} sub={`${d.model.testSamples} test samples`} />
          <MetricCard label="Features" value={d.model.features?.length || d.model.features} />
        </div>
        <div className="border rounded-lg p-4">
          <h3 className="font-medium mb-2">Attack Results</h3>
          <table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th className="pb-1">Attack</th><th>Type</th><th>Evasion Rate</th><th>Clean Acc</th><th>Adversarial Acc</th><th>Status</th></tr></thead>
          <tbody>{d.attacks.map((a: any) => <tr key={a.name}><td className="py-1">{a.name}</td><td>{a.type}</td><td>{(a.evasionRate * 100).toFixed(1)}%</td><td>{(a.cleanAccuracy * 100).toFixed(1)}%</td><td>{(a.adversarialAccuracy * 100).toFixed(1)}%</td><td><span className="text-xs px-1 rounded bg-green-100 dark:bg-green-900">{a.status}</span></td></tr>)}</tbody></table>
        </div>
      </div>
    );
  }

  if (activeTab === 'ai_gnn') {
    const d = gnnQ.data as any;
    if (gnnQ.isLoading) return <Skeleton className="h-64 w-full" />;
    if (!d) return <p className="text-muted-foreground">No GNN data</p>;
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">GNN + Neo4j Fraud Detection — Outbound Remittance</h2>
        <SourceBanner source={d._source} />
        <div className="grid grid-cols-4 gap-4">
          <MetricCard label="Model" value={d.model.name} sub={d.model.framework} />
          <MetricCard label="Accuracy" value={`${(d.model.accuracy * 100).toFixed(1)}%`} sub={`±${(d.model.accuracyStd * 100).toFixed(2)}%`} />
          <MetricCard label="AUC-ROC" value={d.model.aucRoc.toFixed(3)} sub={`CV: ${d.model.cvFolds} folds`} />
          <MetricCard label="Graph" value={`${(d.graphStats.nodes / 1_000_000).toFixed(1)}M nodes`} sub={`${(d.graphStats.edges / 1_000_000).toFixed(1)}M edges`} />
        </div>
        <div className="border rounded-lg p-4">
          <h3 className="font-medium mb-2">Detected Fraud Networks</h3>
          <table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th className="pb-1">ID</th><th>Type</th><th>Nodes</th><th>Edges</th><th>Risk</th><th>Corridors</th><th>Description</th></tr></thead>
          <tbody>{d.detectedNetworks.map((n: any) => <tr key={n.id}><td className="py-1 font-mono text-xs">{n.id}</td><td>{n.type}</td><td>{n.nodes}</td><td>{n.edges}</td><td><span className={`text-xs px-1 rounded ${n.risk_score > 0.8 ? 'bg-red-100 dark:bg-red-900' : 'bg-amber-100 dark:bg-amber-900'}`}>{n.risk_score}</span></td><td>{n.corridors.join(', ')}</td><td className="text-xs">{n.description}</td></tr>)}</tbody></table>
        </div>
      </div>
    );
  }

  if (activeTab === 'ai_mcmc') {
    const d = mcmcQ.data as any;
    if (mcmcQ.isLoading) return <Skeleton className="h-64 w-full" />;
    if (!d) return <p className="text-muted-foreground">No MCMC data</p>;
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">MCMC Bayesian Fraud Scoring — Outbound Remittance</h2>
        <SourceBanner source={d._source} />
        <div className="grid grid-cols-4 gap-4">
          <MetricCard label="Framework" value={d.config.framework.split('(')[0].trim()} sub={d.config.framework} />
          <MetricCard label="Posterior Mean" value={d.scoring.posteriorMean.toFixed(6)} sub={`Std: ${d.scoring.posteriorStd.toFixed(6)}`} />
          <MetricCard label="HDI (94%)" value={`[${d.scoring.hdiLower.toFixed(4)}, ${d.scoring.hdiUpper.toFixed(4)}]`} sub={`R-hat: ${d.scoring.rHat.toFixed(3)}`} />
          <MetricCard label="Risk Level" value={d.scoring.riskLevel} sub={`${d.config.chains} chains × ${d.config.samplesPerChain} samples`} />
        </div>
        <div className="border rounded-lg p-4">
          <h3 className="font-medium mb-2">Example Transaction</h3>
          <div className="text-sm space-y-1">
            <p><span className="text-muted-foreground">Corridor:</span> {d.scoring.exampleTransaction.corridor}</p>
            <p><span className="text-muted-foreground">Amount:</span> ${d.scoring.exampleTransaction.amountUsd.toLocaleString()}</p>
            <p><span className="text-muted-foreground">Direction:</span> {d.scoring.exampleTransaction.direction}</p>
          </div>
        </div>
        <div className="border rounded-lg p-4">
          <h3 className="font-medium mb-2">Corridor Risk Map</h3>
          <table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th className="pb-1">Corridor</th><th>Base Risk</th><th>Label</th></tr></thead>
          <tbody>{d.corridorRiskMap.map((c: any) => <tr key={c.corridor}><td className="py-1 font-mono">{c.corridor}</td><td>{(c.baseRisk * 100).toFixed(1)}%</td><td><span className={`text-xs px-1 rounded ${c.label === 'HIGH' ? 'bg-red-100 dark:bg-red-900' : c.label === 'MEDIUM' ? 'bg-amber-100 dark:bg-amber-900' : 'bg-green-100 dark:bg-green-900'}`}>{c.label}</span></td></tr>)}</tbody></table>
        </div>
      </div>
    );
  }

  return <p className="text-muted-foreground">Select an AI/ML tab from the sidebar</p>;
}

// =============================================================================
// DASHBOARD
// =============================================================================

function DashboardSection({ role }: { role: UserRole }) {
  const isAdmin = role === 'admin' || role === 'cbn';
  const { data: metrics, isLoading } = trpc.outboundRemittance.getDashboardMetrics.useQuery();

  if (isLoading) return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      <Skeleton className="h-64 w-full" />
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{isAdmin ? 'Platform Operations Dashboard' : 'Your Operations Dashboard'}</h1>
        <p className="text-muted-foreground">{isAdmin ? 'System-wide outbound remittance metrics' : 'Real-time view of your outbound transfer pipeline'}</p>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <Card><CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">{isAdmin ? 'Total Transfers' : 'Your Transfers'}</p>
          <p className="text-2xl font-bold"><AnimatedCounter value={metrics?.totalTransfers ?? 0} /></p>
          <Sparkline data={[3, 5, 8, 6, 12, 10, 15]} color="#3b82f6" />
          <p className="text-xs text-muted-foreground">{isAdmin ? 'All participants' : 'Your organization only'}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">Success Rate</p>
          <p className="text-2xl font-bold"><AnimatedCounter value={metrics?.successRate ?? 0} suffix="%" /></p>
          <Sparkline data={[92, 95, 93, 97, 94, 96, 53]} color="#22c55e" />
          <p className="text-xs text-muted-foreground">Computed from DB records</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">Prefund Balance</p>
          <p className="text-2xl font-bold">{metrics?.totalPrefundBalance ? formatNgn(metrics.totalPrefundBalance) : '—'}</p>
          <Sparkline data={[18, 20, 19, 22, 21, 24, 23]} color="#8b5cf6" />
          <p className="text-xs text-muted-foreground">From TigerBeetle ledger</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">{isAdmin ? 'Pending Approvals' : 'Active Corridors'}</p>
          <p className="text-2xl font-bold"><AnimatedCounter value={isAdmin ? metrics?.pendingApprovals ?? 0 : metrics?.activeCorridors ?? 0} /></p>
          <Sparkline data={[2, 4, 3, 5, 7, 6, 5]} color="#f59e0b" />
          <p className="text-xs text-muted-foreground">{isAdmin ? 'Require action' : 'From switch state'}</p>
        </CardContent></Card>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {metrics?.totalVolume ? (
          <Card><CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Volume (Period)</p>
            <p className="text-2xl font-bold">{formatNgn(metrics.totalVolume)}</p>
            <Sparkline data={[120, 180, 150, 220, 280, 310, 396]} color="#3b82f6" />
          </CardContent></Card>
        ) : null}
        <Card><CardContent className="pt-4 flex items-center gap-4">
          <MiniDonut data={[
            { name: 'Completed', value: metrics?.recentTransfers?.filter((t: any) => t.status === 'completed').length ?? 2 },
            { name: 'Routing', value: metrics?.recentTransfers?.filter((t: any) => t.status === 'routing').length ?? 1 },
            { name: 'Admitted', value: metrics?.recentTransfers?.filter((t: any) => t.status === 'admitted').length ?? 1 },
            { name: 'Review', value: metrics?.recentTransfers?.filter((t: any) => t.status === 'manual_review').length ?? 1 },
          ]} />
          <div>
            <p className="text-sm text-muted-foreground">Transfer Status</p>
            <div className="flex flex-wrap gap-2 mt-1">
              <span className="text-xs"><span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1" />Completed</span>
              <span className="text-xs"><span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1" />Routing</span>
              <span className="text-xs"><span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1" />Admitted</span>
              <span className="text-xs"><span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1" />Review</span>
            </div>
          </div>
        </CardContent></Card>
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Recent Transfers</CardTitle>
            {metrics?.recentTransfers && metrics.recentTransfers.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => exportTableToCSV(
                ['Ref', 'Beneficiary', 'Corridor', 'Amount', 'Status'],
                (metrics.recentTransfers as any[]).map((t: any) => [t.transferRef, t.beneficiaryName, t.corridor, t.amountNgn, t.status]),
                'recent-transfers.csv'
              )}><Download className="h-3 w-3 mr-1" />Export</Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {metrics?.recentTransfers && metrics.recentTransfers.length > 0 ? (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Ref</TableHead><TableHead>Beneficiary</TableHead><TableHead>Corridor</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {metrics.recentTransfers.map((t: any) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.transferRef}</TableCell>
                    <TableCell>{t.beneficiaryName}</TableCell>
                    <TableCell><Badge variant="outline">{t.corridor}</Badge></TableCell>
                    <TableCell>{formatNgn(t.amountNgn)}</TableCell>
                    <TableCell><StatusBadge status={t.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : <div className="empty-state"><FileText className="h-12 w-12 mb-2 opacity-30" /><p className="text-sm">No transfers found</p><p className="text-xs">Transfers will appear here once submitted</p></div>}
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// TRANSFERS (with CRUD + Search)
// =============================================================================

function TransfersSection({ role, search }: { role: UserRole; search: string }) {
  const isAdmin = role === 'admin' || role === 'cbn';
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [sortCol, setSortCol] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const { data, isLoading } = trpc.outboundRemittance.listTransfers.useQuery({
    status: statusFilter || undefined,
    search: search || undefined,
    limit: 50,
    offset: 0,
  });
  const createMutation = trpc.outboundRemittance.createTransfer.useMutation();

  const [newTransfer, setNewTransfer] = useState({ beneficiaryName: '', beneficiaryAccount: '', corridor: 'NG-GH', amountNgn: '', destCurrency: 'GHS', purpose: 'Family Support', senderRef: '' });

  const handleCreate = async () => {
    if (!newTransfer.beneficiaryName || !newTransfer.amountNgn) return;
    await createMutation.mutateAsync(newTransfer);
    setShowCreateForm(false);
    setNewTransfer({ beneficiaryName: '', beneficiaryAccount: '', corridor: 'NG-GH', amountNgn: '', destCurrency: 'GHS', purpose: 'Family Support', senderRef: '' });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{isAdmin ? 'All Transfers (System-Wide)' : 'My Transfers'}</h1>
          <p className="text-muted-foreground">{isAdmin ? 'Cross-border transfers from all participants' : 'Transfers submitted by your organization via API'}</p>
        </div>
        {!isAdmin && <Button onClick={() => setShowCreateForm(!showCreateForm)}><Plus className="h-4 w-4 mr-1" /> Submit Transfer</Button>}
      </div>

      {/* Create Transfer Form */}
      {showCreateForm && !isAdmin && (
        <Card>
          <CardHeader><CardTitle>Submit New Transfer</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div><Label>Sender Reference</Label><Input value={newTransfer.senderRef} onChange={e => setNewTransfer(p => ({...p, senderRef: e.target.value}))} placeholder="Your internal ref" /></div>
            <div><Label>Beneficiary Name</Label><Input value={newTransfer.beneficiaryName} onChange={e => setNewTransfer(p => ({...p, beneficiaryName: e.target.value}))} placeholder="Full name" /></div>
            <div><Label>Beneficiary Account</Label><Input value={newTransfer.beneficiaryAccount} onChange={e => setNewTransfer(p => ({...p, beneficiaryAccount: e.target.value}))} placeholder="Account/IBAN" /></div>
            <div><Label>Corridor</Label>
              <Select value={newTransfer.corridor} onValueChange={v => setNewTransfer(p => ({...p, corridor: v, destCurrency: corridors.find(c => c.id === v)?.currency ?? 'USD'}))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{corridors.map(c => <SelectItem key={c.id} value={c.id}>{c.id} — {c.dest}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Amount (NGN)</Label><Input type="number" value={newTransfer.amountNgn} onChange={e => setNewTransfer(p => ({...p, amountNgn: e.target.value}))} placeholder="e.g. 5000000" /></div>
            <div><Label>Purpose</Label>
              <Select value={newTransfer.purpose} onValueChange={v => setNewTransfer(p => ({...p, purpose: v}))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Family Support">Family Support</SelectItem>
                  <SelectItem value="Education">Education</SelectItem>
                  <SelectItem value="Medical">Medical</SelectItem>
                  <SelectItem value="Business Payment">Business Payment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 flex gap-2">
              <Button onClick={handleCreate} disabled={createMutation.isPending}>{createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 mr-1" />} Submit</Button>
              <Button variant="outline" onClick={() => setShowCreateForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex gap-2">
        {['', 'admitted', 'routing', 'completed', 'manual_review', 'failed', 'blocked'].map(s => (
          <Button key={s} variant={statusFilter === s ? 'default' : 'outline'} size="sm" onClick={() => setStatusFilter(s)}>
            {s || 'All'}
          </Button>
        ))}
        <span className="ml-auto text-sm text-muted-foreground">{data?.total ?? 0} transfers</span>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{isAdmin ? 'All Transfers' : 'My Transfers'}</CardTitle>
            <div className="flex gap-2">
              {data?.transfers && data.transfers.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => exportTableToCSV(
                  ['Ref', 'Beneficiary', 'Corridor', 'Amount', 'Status', 'Step'],
                  (data.transfers as any[]).map((t: any) => [t.transferRef, t.beneficiaryName, t.corridor, t.amountNgn, t.status, t.lifecycleStep]),
                  'transfers.csv'
                )}><Download className="h-3 w-3 mr-1" />Export</Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? <TableSkeleton rows={8} cols={7} /> : (
            <Table>
              <TableHeader><TableRow>
                <SortableHeader label="Ref" sortKey="transferRef" currentSort={sortCol} onSort={(k) => setSortCol(prev => prev?.key === k ? { key: k, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' })} />
                {isAdmin && <TableHead>Participant</TableHead>}
                <SortableHeader label="Beneficiary" sortKey="beneficiaryName" currentSort={sortCol} onSort={(k) => setSortCol(prev => prev?.key === k ? { key: k, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' })} />
                <TableHead>Corridor</TableHead>
                <SortableHeader label="Amount (NGN)" sortKey="amountNgn" currentSort={sortCol} onSort={(k) => setSortCol(prev => prev?.key === k ? { key: k, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' })} />
                <TableHead>Provider</TableHead><TableHead>Status</TableHead><TableHead>Step</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(data?.transfers as any[] || []).sort((a: any, b: any) => {
                  if (!sortCol) return 0;
                  const aVal = a[sortCol.key]; const bVal = b[sortCol.key];
                  const cmp = typeof aVal === 'number' ? aVal - bVal : String(aVal).localeCompare(String(bVal));
                  return sortCol.dir === 'asc' ? cmp : -cmp;
                }).slice(page * pageSize, (page + 1) * pageSize).map((t: any) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.transferRef}</TableCell>
                    {isAdmin && <TableCell className="text-xs">{t.senderRef?.split('-')[0]}</TableCell>}
                    <TableCell>{t.beneficiaryName}</TableCell>
                    <TableCell><Badge variant="outline">{t.corridor}</Badge></TableCell>
                    <TableCell>{formatNgn(t.amountNgn)}</TableCell>
                    <TableCell className="text-xs">{t.provider ?? '—'}</TableCell>
                    <TableCell><StatusBadge status={t.status} /></TableCell>
                    <TableCell className="text-xs font-mono">{t.lifecycleStep}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {/* Pagination */}
          {data?.transfers && data.transfers.length > pageSize && (
            <div className="flex items-center justify-between p-4 border-t">
              <span className="text-xs text-muted-foreground">Page {page + 1} of {Math.ceil((data.total || data.transfers.length) / pageSize)}</span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-3 w-3" /></Button>
                <Button variant="outline" size="sm" disabled={(page + 1) * pageSize >= (data.total || data.transfers.length)} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-3 w-3" /></Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// PREFUND (with Funding Request)
// =============================================================================

function PrefundSection({ role }: { role: UserRole }) {
  const isAdmin = role === 'admin' || role === 'cbn';
  const { data: accounts, isLoading } = trpc.outboundRemittance.getPrefundAccounts.useQuery();
  const { data: fundingRequests } = trpc.outboundRemittance.listFundingRequests.useQuery();
  const fundingMutation = trpc.outboundRemittance.requestFunding.useMutation();
  const [showFundForm, setShowFundForm] = useState(false);
  const [fundReq, setFundReq] = useState({ amount: '', sourceBank: '', sourceAccount: '', method: 'RTGS' as const });

  const handleFund = async () => {
    if (!fundReq.amount || !fundReq.sourceBank) return;
    await fundingMutation.mutateAsync(fundReq);
    setShowFundForm(false);
    setFundReq({ amount: '', sourceBank: '', sourceAccount: '', method: 'RTGS' });
  };

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{isAdmin ? 'Prefund Accounts (All Participants)' : 'My Prefund Account'}</h1>
          <p className="text-muted-foreground">{isAdmin ? 'TigerBeetle ledger balances' : 'Your TigerBeetle ledger account balance and deductions'}</p>
        </div>
        {!isAdmin && <Button onClick={() => setShowFundForm(!showFundForm)}><Plus className="h-4 w-4 mr-1" /> Request Funding</Button>}
      </div>

      {/* Fund Request Form */}
      {showFundForm && !isAdmin && (
        <Card>
          <CardHeader><CardTitle>Request Prefund Top-Up</CardTitle><CardDescription>Submit a funding request — admin will approve and credit your TigerBeetle account</CardDescription></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div><Label>Amount (NGN)</Label><Input type="number" value={fundReq.amount} onChange={e => setFundReq(p => ({...p, amount: e.target.value}))} placeholder="e.g. 500000000" /></div>
            <div><Label>Source Bank</Label><Input value={fundReq.sourceBank} onChange={e => setFundReq(p => ({...p, sourceBank: e.target.value}))} placeholder="e.g. Zenith Bank Plc" /></div>
            <div><Label>Source Account</Label><Input value={fundReq.sourceAccount} onChange={e => setFundReq(p => ({...p, sourceAccount: e.target.value}))} placeholder="Account number" /></div>
            <div><Label>Method</Label>
              <Select value={fundReq.method} onValueChange={(v: any) => setFundReq(p => ({...p, method: v}))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="RTGS">RTGS</SelectItem><SelectItem value="NIP">NIP (Instant)</SelectItem><SelectItem value="Wire">Wire Transfer</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="col-span-2 flex gap-2">
              <Button onClick={handleFund} disabled={fundingMutation.isPending}>{fundingMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 mr-1" />} Submit Request</Button>
              <Button variant="outline" onClick={() => setShowFundForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Accounts */}
      {accounts && accounts.length > 0 ? accounts.map((account: any) => (
        <Card key={account.id}>
          <CardHeader>
            <CardTitle className="text-lg">Account: {account.accountRef}</CardTitle>
            <CardDescription>Family: {account.accountFamily} | Bank: {account.settlementBank ?? '—'}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="p-3 bg-green-50 rounded"><p className="text-xs text-muted-foreground">Balance</p><p className="text-xl font-bold text-green-700">{formatNgn(account.balance)}</p></div>
              <div className="p-3 bg-orange-50 rounded"><p className="text-xs text-muted-foreground">Today's Deductions</p><p className="text-xl font-bold text-orange-700">{formatNgn(account.todayDeductions)}</p></div>
              <div className="p-3 bg-blue-50 rounded"><p className="text-xs text-muted-foreground">Daily Limit</p><p className="text-xl font-bold text-blue-700">{formatNgn(account.dailyLimit)}</p></div>
            </div>
            {account.lowBalanceThreshold && parseFloat(account.balance) < parseFloat(account.lowBalanceThreshold) && (
              <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                <span className="text-sm text-red-700">Balance below threshold ({formatNgn(account.lowBalanceThreshold)}) — top up required</span>
              </div>
            )}
          </CardContent>
        </Card>
      )) : <Card><CardContent className="py-8 text-center text-muted-foreground">No prefund accounts found.</CardContent></Card>}

      {/* Funding History */}
      {fundingRequests && fundingRequests.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Funding Requests</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Ref</TableHead><TableHead>Amount</TableHead><TableHead>Bank</TableHead><TableHead>Method</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
              <TableBody>
                {fundingRequests.map((f: any) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-mono text-xs">{f.requestRef}</TableCell>
                    <TableCell className="font-bold">{formatNgn(f.amount)}</TableCell>
                    <TableCell>{f.sourceBank}</TableCell>
                    <TableCell><Badge variant="outline">{f.method}</Badge></TableCell>
                    <TableCell><StatusBadge status={f.status} /></TableCell>
                    <TableCell className="text-xs">{new Date(f.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// =============================================================================
// BILLING
// =============================================================================

function BillingSection({ role }: { role: UserRole }) {
  const isAdmin = role === 'admin' || role === 'cbn';
  const { data: records, isLoading } = trpc.outboundRemittance.getBilling.useQuery();

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{isAdmin ? 'Billing (All Participants)' : 'My Billing'}</h1>
        <p className="text-muted-foreground">{isAdmin ? 'System-wide billing and invoices' : 'Your subscription and fee records'}</p>
      </div>
      <Card>
        <CardContent className="p-0">
          {records && records.length > 0 ? (
            <Table>
              <TableHeader><TableRow><TableHead>Period</TableHead><TableHead>Subscription</TableHead><TableHead>Txn Fees</TableHead><TableHead>Corridor Fees</TableHead><TableHead>FX Share</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {records.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.billingPeriod}</TableCell>
                    <TableCell>{formatNgn(r.subscriptionFee)}</TableCell>
                    <TableCell>{formatNgn(r.transactionFees)}</TableCell>
                    <TableCell>{formatNgn(r.corridorFees)}</TableCell>
                    <TableCell>{formatNgn(r.fxRevenueShare)}</TableCell>
                    <TableCell className="font-bold">{formatNgn(r.totalAmount)}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : <p className="text-center py-8 text-muted-foreground">No billing records found</p>}
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// DISPUTES (with Create + Resolve)
// =============================================================================

function DisputesSection({ role }: { role: UserRole }) {
  const isAdmin = role === 'admin' || role === 'cbn';
  const { data: disputes, isLoading, refetch } = trpc.outboundRemittance.listDisputes.useQuery();
  const resolveMutation = trpc.outboundRemittance.resolveDispute.useMutation({ onSuccess: () => refetch() });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{isAdmin ? 'All Disputes' : 'My Disputes'}</h1>
        <p className="text-muted-foreground">{isAdmin ? 'Transaction disputes across all participants' : 'Disputes raised by your organization'}</p>
      </div>
      <Card>
        <CardContent className="p-0">
          {disputes && disputes.length > 0 ? (
            <Table>
              <TableHeader><TableRow><TableHead>Ref</TableHead><TableHead>Type</TableHead><TableHead>Reason</TableHead><TableHead>Amount</TableHead><TableHead>Priority</TableHead><TableHead>Status</TableHead>{isAdmin && <TableHead>Action</TableHead>}</TableRow></TableHeader>
              <TableBody>
                {disputes.map((d: any) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono text-xs">{d.disputeRef}</TableCell>
                    <TableCell><Badge variant="outline">{d.type.replace(/_/g, ' ')}</Badge></TableCell>
                    <TableCell className="max-w-xs truncate text-xs">{d.reason}</TableCell>
                    <TableCell>{formatNgn(d.amount)}</TableCell>
                    <TableCell><StatusBadge status={d.priority} /></TableCell>
                    <TableCell><StatusBadge status={d.status} /></TableCell>
                    {isAdmin && d.status === 'open' && (
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => resolveMutation.mutate({ disputeId: d.id, action: 'resolved', resolution: 'Reviewed and resolved by admin' })}>
                          Resolve
                        </Button>
                      </TableCell>
                    )}
                    {isAdmin && d.status !== 'open' && <TableCell>—</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : <p className="text-center py-8 text-muted-foreground">No disputes found</p>}
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// APPROVALS (Admin/CBN only)
// =============================================================================

function ApprovalsSection({ role }: { role: UserRole }) {
  const isAdmin = role === 'admin' || role === 'cbn';
  if (!isAdmin) return <p className="text-muted-foreground">Access denied — admin/CBN only</p>;

  const { data: approvals, isLoading, refetch } = trpc.outboundRemittance.listApprovals.useQuery();
  const processMutation = trpc.outboundRemittance.processApproval.useMutation({ onSuccess: () => refetch() });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Approval Queue</h1>
        <p className="text-muted-foreground">Pending items requiring admin/CBN authorization</p>
      </div>
      {approvals && approvals.length > 0 ? approvals.map((a: any) => (
        <Card key={a.id}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">{a.action.replace(/_/g, ' ').toUpperCase()}</CardTitle>
                <CardDescription>{a.requestedByName} • {a.entityType}</CardDescription>
              </div>
              <Badge variant="outline">{a.entityType}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm mb-4">{a.reason}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => processMutation.mutate({ approvalId: a.id, action: 'approved' })} disabled={processMutation.isPending}>
                <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
              </Button>
              <Button size="sm" variant="destructive" onClick={() => processMutation.mutate({ approvalId: a.id, action: 'rejected', notes: 'Rejected by admin' })} disabled={processMutation.isPending}>
                <XCircle className="h-4 w-4 mr-1" /> Reject
              </Button>
            </div>
          </CardContent>
        </Card>
      )) : <Card><CardContent className="py-8 text-center text-muted-foreground">No pending approvals</CardContent></Card>}
    </div>
  );
}

// =============================================================================
// COMPLIANCE
// =============================================================================

function ComplianceSection({ role }: { role: UserRole }) {
  const isAdmin = role === 'admin' || role === 'cbn';
  const { data: screenings, isLoading } = trpc.outboundRemittance.getComplianceScreenings.useQuery();

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{isAdmin ? 'Compliance & Sanctions (System-Wide)' : 'My Compliance'}</h1>
        <p className="text-muted-foreground">{isAdmin ? 'Screening results across all participants' : 'Sanctions screening results for your transfers'}</p>
      </div>
      <Card>
        <CardContent className="p-0">
          {screenings && screenings.length > 0 ? (
            <Table>
              <TableHeader><TableRow><TableHead>Transfer</TableHead><TableHead>Type</TableHead><TableHead>List</TableHead><TableHead>Score</TableHead><TableHead>Decision</TableHead><TableHead>Matched Entity</TableHead></TableRow></TableHeader>
              <TableBody>
                {screenings.map((s: any) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">#{s.transferId}</TableCell>
                    <TableCell>{s.screeningType}</TableCell>
                    <TableCell className="text-xs">{s.listChecked}</TableCell>
                    <TableCell><Badge variant={parseFloat(s.matchScore) > 0.75 ? 'destructive' : 'outline'}>{(parseFloat(s.matchScore) * 100).toFixed(0)}%</Badge></TableCell>
                    <TableCell><StatusBadge status={s.decision} /></TableCell>
                    <TableCell className="max-w-xs truncate text-xs">{s.matchedEntity ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : <p className="text-center py-8 text-muted-foreground">No compliance screenings found</p>}
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// PARTICIPANTS (Admin only)
// =============================================================================

function ParticipantsSection({ role }: { role: UserRole }) {
  const isAdmin = role === 'admin' || role === 'cbn';
  if (!isAdmin) return <p className="text-muted-foreground">Access denied</p>;

  const utils = trpc.useUtils();
  const { data: participants, isLoading } = trpc.outboundRemittance.listParticipants.useQuery();
  const { data: enforcement } = trpc.outboundRemittance.listEnforcementActions.useQuery({});
  const suspendMut = trpc.outboundRemittance.suspendParticipant.useMutation({ onSuccess: () => { utils.outboundRemittance.listParticipants.invalidate(); utils.outboundRemittance.listEnforcementActions.invalidate(); toast.success('Participant suspended'); } });
  const reinstateMut = trpc.outboundRemittance.reinstateParticipant.useMutation({ onSuccess: () => { utils.outboundRemittance.listParticipants.invalidate(); utils.outboundRemittance.listEnforcementActions.invalidate(); toast.success('Participant reinstated'); } });

  const [suspendForm, setSuspendForm] = useState<{ id: number; name: string } | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [suspendRef, setSuspendRef] = useState('');

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const activeEnforcementByParticipant = (pid: number) =>
    enforcement?.actions?.filter((a: any) => a.participantId === pid && a.status === 'active') ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Participants</h1>
        <p className="text-muted-foreground">Licensed IMTOs and fintechs on the switch</p>
      </div>

      {/* Suspend Participant Form */}
      {suspendForm && (
        <Card className="border-red-200 bg-red-50 dark:bg-red-950/20">
          <CardHeader><CardTitle className="text-red-700 dark:text-red-400 flex items-center gap-2"><Ban className="h-4 w-4" /> Suspend {suspendForm.name}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div><Label>CBN Reference</Label><Input placeholder="CBN/ENF/2026/XXXX" value={suspendRef} onChange={e => setSuspendRef(e.target.value)} /></div>
            <div><Label>Reason for Suspension</Label><textarea className="w-full border rounded-md p-2 text-sm min-h-[80px]" placeholder="Detailed reason for enforcement action..." value={suspendReason} onChange={e => setSuspendReason(e.target.value)} /></div>
            <div className="flex gap-2">
              <Button variant="destructive" disabled={!suspendReason || !suspendRef || suspendMut.isPending} onClick={() => {
                suspendMut.mutate({ participantId: suspendForm.id, reason: suspendReason, cbnReference: suspendRef });
                setSuspendForm(null); setSuspendReason(''); setSuspendRef('');
              }}>{suspendMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4 mr-1" />} Confirm Suspension</Button>
              <Button variant="outline" onClick={() => { setSuspendForm(null); setSuspendReason(''); setSuspendRef(''); }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Code</TableHead><TableHead>Type</TableHead><TableHead>CBN License</TableHead><TableHead>Tier</TableHead><TableHead>Corridors</TableHead><TableHead>Status</TableHead><TableHead>Enforcement</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {participants?.map((p: any) => {
                const pEnforcements = activeEnforcementByParticipant(p.id);
                return (
                  <TableRow key={p.id} className={p.status === 'suspended' ? 'bg-red-50 dark:bg-red-950/10' : p.status === 'revoked' ? 'bg-gray-100 dark:bg-gray-900/30' : ''}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="font-mono">{p.shortCode}</TableCell>
                    <TableCell><Badge variant="outline">{p.type}</Badge></TableCell>
                    <TableCell className="text-xs">{p.cbnLicense}</TableCell>
                    <TableCell><Badge>{p.tier}</Badge></TableCell>
                    <TableCell>{p.activeCorridors}</TableCell>
                    <TableCell><StatusBadge status={p.status} /></TableCell>
                    <TableCell>
                      {pEnforcements.length > 0 ? (
                        <div className="flex flex-col gap-0.5">
                          {pEnforcements.map((e: any) => (
                            <Badge key={e.id} variant="destructive" className="text-[10px]">
                              {e.type === 'suspension' ? 'Suspended' : e.type === 'corridor_restriction' ? 'Corridor Restricted' : e.type === 'limit_override' ? 'Limit Override' : e.type}
                            </Badge>
                          ))}
                        </div>
                      ) : <span className="text-xs text-muted-foreground">None</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {p.status === 'active' && (
                          <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => setSuspendForm({ id: p.id, name: p.name })}>
                            <Ban className="h-3 w-3 mr-1" /> Suspend
                          </Button>
                        )}
                        {p.status === 'suspended' && pEnforcements.find((e: any) => e.type === 'suspension') && (
                          <Button size="sm" variant="outline" className="h-7 text-xs border-green-500 text-green-700" onClick={() => {
                            const enfAction = pEnforcements.find((e: any) => e.type === 'suspension');
                            if (enfAction) reinstateMut.mutate({ participantId: p.id, enforcementId: enfAction.id, resolutionNote: 'Reinstated by admin — compliance issue resolved' });
                          }}>
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Reinstate
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// CBN ENFORCEMENT DASHBOARD
// =============================================================================

function EnforcementSection({ role }: { role: UserRole }) {
  const isAdmin = role === 'admin' || role === 'cbn';
  if (!isAdmin) return <p className="text-muted-foreground">Access denied — CBN/Admin only</p>;

  const utils = trpc.useUtils();
  const [activeTab, setActiveTab] = useState<'actions' | 'triggers' | 'new_action'>('actions');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');

  const { data: enforcement, isLoading } = trpc.outboundRemittance.listEnforcementActions.useQuery(
    { status: (statusFilter || undefined) as any, type: typeFilter || undefined },
  );
  const { data: participants } = trpc.outboundRemittance.listParticipants.useQuery();
  const { data: triggers } = trpc.outboundRemittance.listAutoTriggers.useQuery();

  const suspendMut = trpc.outboundRemittance.suspendParticipant.useMutation({ onSuccess: () => { utils.outboundRemittance.listEnforcementActions.invalidate(); utils.outboundRemittance.listParticipants.invalidate(); toast.success('Participant suspended'); } });
  const restrictMut = trpc.outboundRemittance.restrictCorridors.useMutation({ onSuccess: () => { utils.outboundRemittance.listEnforcementActions.invalidate(); toast.success('Corridor restriction applied'); } });
  const limitMut = trpc.outboundRemittance.overrideLimits.useMutation({ onSuccess: () => { utils.outboundRemittance.listEnforcementActions.invalidate(); toast.success('Limit override applied'); } });
  const directiveMut = trpc.outboundRemittance.issueDirective.useMutation({ onSuccess: () => { utils.outboundRemittance.listEnforcementActions.invalidate(); toast.success('Compliance directive issued'); } });
  const revokeMut = trpc.outboundRemittance.revokeLicense.useMutation({ onSuccess: () => { utils.outboundRemittance.listEnforcementActions.invalidate(); utils.outboundRemittance.listParticipants.invalidate(); toast.success('License revoked'); } });
  const resolveMut = trpc.outboundRemittance.resolveEnforcement.useMutation({ onSuccess: () => { utils.outboundRemittance.listEnforcementActions.invalidate(); utils.outboundRemittance.listParticipants.invalidate(); toast.success('Enforcement action resolved'); } });
  const createTriggerMut = trpc.outboundRemittance.createAutoTrigger.useMutation({ onSuccess: () => { utils.outboundRemittance.listAutoTriggers.invalidate(); toast.success('Auto-trigger created'); } });
  const updateTriggerMut = trpc.outboundRemittance.updateAutoTrigger.useMutation({ onSuccess: () => { utils.outboundRemittance.listAutoTriggers.invalidate(); toast.success('Trigger updated'); } });
  const deleteTriggerMut = trpc.outboundRemittance.deleteAutoTrigger.useMutation({ onSuccess: () => { utils.outboundRemittance.listAutoTriggers.invalidate(); toast.success('Trigger deleted'); } });

  // New action form state
  const [actionType, setActionType] = useState<string>('suspension');
  const [targetParticipant, setTargetParticipant] = useState<string>('');
  const [actionReason, setActionReason] = useState('');
  const [actionRef, setActionRef] = useState('');
  const [restrictedCorridors, setRestrictedCorridors] = useState('');
  const [newLimit, setNewLimit] = useState('');
  const [newTxnMax, setNewTxnMax] = useState('');
  const [directiveActions, setDirectiveActions] = useState('');
  const [expiryDays, setExpiryDays] = useState('30');

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const handleSubmitAction = () => {
    const pid = parseInt(targetParticipant);
    if (!pid || !actionReason || !actionRef) return;
    switch (actionType) {
      case 'suspension':
        suspendMut.mutate({ participantId: pid, reason: actionReason, cbnReference: actionRef });
        break;
      case 'corridor_restriction':
        restrictMut.mutate({ participantId: pid, restrictedCorridors: restrictedCorridors.split(',').map(s => s.trim()).filter(Boolean), reason: actionReason, cbnReference: actionRef, expiresInDays: parseInt(expiryDays) || 30 });
        break;
      case 'limit_override':
        limitMut.mutate({ participantId: pid, newDailyLimit: newLimit || undefined, newTransactionMax: newTxnMax || undefined, reason: actionReason, cbnReference: actionRef, expiresInDays: parseInt(expiryDays) || 30 });
        break;
      case 'warning': case 'show_cause': case 'remediation_order':
        directiveMut.mutate({ participantId: pid, directiveType: actionType as any, reason: actionReason, cbnReference: actionRef, requiredActions: directiveActions.split('\n').filter(Boolean), deadlineDays: parseInt(expiryDays) || 30 });
        break;
      case 'license_revocation':
        revokeMut.mutate({ participantId: pid, reason: actionReason, cbnReference: actionRef });
        break;
    }
    setActiveTab('actions');
    setActionReason(''); setActionRef(''); setTargetParticipant(''); setRestrictedCorridors(''); setNewLimit(''); setNewTxnMax(''); setDirectiveActions('');
  };

  const enforcementTypeColors: Record<string, string> = {
    suspension: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    corridor_restriction: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
    limit_override: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    compliance_directive: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    license_revocation: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
    warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    show_cause: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ShieldAlert className="h-6 w-6 text-red-600" /> CBN Enforcement</h1>
          <p className="text-muted-foreground">Suspend, restrict, and manage compliance enforcement actions against participants</p>
        </div>
        <Button onClick={() => setActiveTab('new_action')} className="bg-red-600 hover:bg-red-700"><Plus className="h-4 w-4 mr-1" /> New Enforcement Action</Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Active Actions</div><div className="text-2xl font-bold text-red-600">{enforcement?.summary?.active ?? 0}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Pending Review</div><div className="text-2xl font-bold text-amber-600">{enforcement?.summary?.pendingReview ?? 0}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Active Suspensions</div><div className="text-2xl font-bold text-red-700">{enforcement?.summary?.suspensions ?? 0}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Resolved</div><div className="text-2xl font-bold text-green-600">{enforcement?.summary?.resolved ?? 0}</div></CardContent></Card>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b pb-2">
        {(['actions', 'triggers', 'new_action'] as const).map(tab => (
          <Button key={tab} variant={activeTab === tab ? 'default' : 'outline'} size="sm" onClick={() => setActiveTab(tab)}>
            {tab === 'actions' ? 'Enforcement Actions' : tab === 'triggers' ? 'Auto-Suspension Triggers' : 'New Action'}
          </Button>
        ))}
      </div>

      {/* Actions List */}
      {activeTab === 'actions' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            {['', 'active', 'pending_review', 'resolved', 'expired'].map(s => (
              <Button key={s} variant={statusFilter === s ? 'default' : 'outline'} size="sm" onClick={() => setStatusFilter(s)}>{s || 'All'}</Button>
            ))}
            <div className="ml-auto flex gap-2">
              {['', 'suspension', 'corridor_restriction', 'limit_override', 'compliance_directive', 'warning'].map(t => (
                <Button key={t} variant={typeFilter === t ? 'default' : 'outline'} size="sm" onClick={() => setTypeFilter(t)} className="text-xs">{t ? t.replace(/_/g, ' ') : 'All Types'}</Button>
              ))}
            </div>
          </div>

          {enforcement?.actions?.map((action: any) => (
            <Card key={action.id} className={`border-l-4 ${action.status === 'active' ? 'border-l-red-500' : action.status === 'pending_review' ? 'border-l-amber-500' : action.status === 'resolved' ? 'border-l-green-500' : 'border-l-gray-400'}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${enforcementTypeColors[action.type] || 'bg-gray-100'}`}>
                        {action.type.replace(/_/g, ' ').toUpperCase()}
                      </span>
                      <Badge variant={action.status === 'active' ? 'destructive' : action.status === 'resolved' ? 'default' : 'secondary'}>{action.status}</Badge>
                      <span className="text-xs text-muted-foreground font-mono">{action.cbnReference}</span>
                    </div>
                    <p className="font-medium">{action.participantName}</p>
                    <p className="text-sm text-muted-foreground">{action.reason}</p>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>Issued: {new Date(action.issuedAt).toLocaleDateString()}</span>
                      <span>By: {action.issuedBy}</span>
                      {action.expiresAt && <span>Expires: {new Date(action.expiresAt).toLocaleDateString()}</span>}
                      {action.resolvedAt && <span className="text-green-600">Resolved: {new Date(action.resolvedAt).toLocaleDateString()}</span>}
                    </div>
                    {/* Details */}
                    {action.details && (
                      <div className="mt-2 bg-muted/50 rounded p-2 text-xs">
                        {action.type === 'corridor_restriction' && action.details.restrictedCorridors && (
                          <span>Restricted corridors: {action.details.restrictedCorridors.join(', ')}</span>
                        )}
                        {action.type === 'limit_override' && (
                          <span>Limit: {action.details.originalLimit ? `₦${Number(action.details.originalLimit).toLocaleString()}` : '—'} → {action.details.overrideLimit ? `₦${Number(action.details.overrideLimit).toLocaleString()}` : '—'}</span>
                        )}
                        {action.type === 'compliance_directive' && action.details.requiredActions && (
                          <ul className="list-disc list-inside">{action.details.requiredActions.map((a: string, i: number) => <li key={i}>{a}</li>)}</ul>
                        )}
                        {action.type === 'suspension' && action.details.sanctionsHitRate && (
                          <span>Sanctions hit rate: {action.details.sanctionsHitRate}% (threshold: {action.details.threshold}%)</span>
                        )}
                        {action.resolutionNote && <p className="mt-1 text-green-700 dark:text-green-400">Resolution: {action.resolutionNote}</p>}
                      </div>
                    )}
                  </div>
                  {(action.status === 'active' || action.status === 'pending_review') && (
                    <Button size="sm" variant="outline" className="border-green-500 text-green-700 ml-4" onClick={() => resolveMut.mutate({ enforcementId: action.id, resolutionNote: 'Resolved — compliance requirements met, remediation completed.' })}>
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Resolve
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {enforcement?.actions?.length === 0 && <p className="text-center text-muted-foreground py-8">No enforcement actions found</p>}
        </div>
      )}

      {/* Auto-Suspension Triggers */}
      {activeTab === 'triggers' && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Zap className="h-4 w-4 text-amber-500" /> Auto-Suspension Triggers</CardTitle>
              <CardDescription>Configurable rules that automatically trigger enforcement actions when thresholds are breached</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Metric</TableHead><TableHead>Condition</TableHead><TableHead>Window</TableHead><TableHead>Action</TableHead><TableHead>Triggered</TableHead><TableHead>Status</TableHead><TableHead>Controls</TableHead></TableRow></TableHeader>
                <TableBody>
                  {triggers?.map((trigger: any) => (
                    <TableRow key={trigger.id}>
                      <TableCell>
                        <div><p className="font-medium text-sm">{trigger.name}</p><p className="text-xs text-muted-foreground">{trigger.description}</p></div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{trigger.metric}</TableCell>
                      <TableCell className="text-sm">{trigger.operator === 'gt' ? '>' : trigger.operator === 'lt' ? '<' : trigger.operator === 'gte' ? '≥' : '≤'} {trigger.threshold}{trigger.unit}</TableCell>
                      <TableCell className="text-sm">{trigger.windowDays}d</TableCell>
                      <TableCell><Badge variant={trigger.action === 'suspend' ? 'destructive' : trigger.action === 'warning' ? 'secondary' : 'outline'}>{trigger.action}</Badge></TableCell>
                      <TableCell className="text-xs">{trigger.triggeredCount > 0 ? `${trigger.triggeredCount}× (last: ${new Date(trigger.lastTriggered).toLocaleDateString()})` : 'Never'}</TableCell>
                      <TableCell>{trigger.isActive ? <Badge className="bg-green-600">Active</Badge> : <Badge variant="secondary">Disabled</Badge>}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => updateTriggerMut.mutate({ id: trigger.id, isActive: !trigger.isActive })}>
                            {trigger.isActive ? <ToggleRight className="h-4 w-4 text-green-600" /> : <ToggleLeft className="h-4 w-4 text-gray-400" />}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500" onClick={() => deleteTriggerMut.mutate({ id: trigger.id })}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* New Trigger Form */}
          <Card>
            <CardHeader><CardTitle className="text-lg">Add New Trigger</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={e => { e.preventDefault(); const fd = new FormData(e.currentTarget);
                createTriggerMut.mutate({
                  name: fd.get('name') as string, description: fd.get('description') as string,
                  metric: fd.get('metric') as string, operator: fd.get('operator') as any,
                  threshold: parseFloat(fd.get('threshold') as string), unit: fd.get('unit') as string,
                  windowDays: parseInt(fd.get('windowDays') as string), action: fd.get('action') as any,
                });
                e.currentTarget.reset();
              }} className="grid grid-cols-4 gap-3">
                <div className="col-span-2"><Label>Name</Label><Input name="name" required placeholder="e.g. High Failure Rate" /></div>
                <div className="col-span-2"><Label>Description</Label><Input name="description" required placeholder="What this trigger monitors" /></div>
                <div><Label>Metric</Label><Input name="metric" required placeholder="e.g. failure_rate" /></div>
                <div><Label>Operator</Label><Select name="operator" defaultValue="gt"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="gt">&gt;</SelectItem><SelectItem value="lt">&lt;</SelectItem><SelectItem value="gte">≥</SelectItem><SelectItem value="lte">≤</SelectItem></SelectContent></Select></div>
                <div><Label>Threshold</Label><Input name="threshold" type="number" required placeholder="5" /></div>
                <div><Label>Unit</Label><Input name="unit" required placeholder="%" /></div>
                <div><Label>Window (days)</Label><Input name="windowDays" type="number" required defaultValue="30" /></div>
                <div><Label>Action</Label><Select name="action" defaultValue="warning"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="suspend">Suspend</SelectItem><SelectItem value="restrict_corridors">Restrict Corridors</SelectItem><SelectItem value="reduce_limit">Reduce Limit</SelectItem><SelectItem value="warning">Warning</SelectItem></SelectContent></Select></div>
                <div className="col-span-2 flex items-end"><Button type="submit" disabled={createTriggerMut.isPending}><Plus className="h-4 w-4 mr-1" /> Add Trigger</Button></div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* New Action Form */}
      {activeTab === 'new_action' && (
        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-red-600" /> Issue New Enforcement Action</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Action Type</Label>
                <Select value={actionType} onValueChange={setActionType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="suspension"><span className="flex items-center gap-2"><Ban className="h-3 w-3 text-red-500" /> Full Suspension</span></SelectItem>
                    <SelectItem value="corridor_restriction"><span className="flex items-center gap-2"><Globe className="h-3 w-3 text-orange-500" /> Corridor Restriction</span></SelectItem>
                    <SelectItem value="limit_override"><span className="flex items-center gap-2"><Scale className="h-3 w-3 text-yellow-500" /> Limit Override</span></SelectItem>
                    <SelectItem value="warning"><span className="flex items-center gap-2"><AlertTriangle className="h-3 w-3 text-amber-500" /> Warning</span></SelectItem>
                    <SelectItem value="show_cause"><span className="flex items-center gap-2"><FileText className="h-3 w-3 text-blue-500" /> Show-Cause Notice</span></SelectItem>
                    <SelectItem value="remediation_order"><span className="flex items-center gap-2"><Shield className="h-3 w-3 text-indigo-500" /> Remediation Order</span></SelectItem>
                    <SelectItem value="license_revocation"><span className="flex items-center gap-2"><XCircle className="h-3 w-3 text-purple-500" /> License Revocation</span></SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Target Participant</Label>
                <Select value={targetParticipant} onValueChange={setTargetParticipant}>
                  <SelectTrigger><SelectValue placeholder="Select participant" /></SelectTrigger>
                  <SelectContent>
                    {participants?.map((p: any) => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.name} ({p.shortCode})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>CBN Reference Number</Label><Input placeholder="CBN/ENF/2026/XXXX" value={actionRef} onChange={e => setActionRef(e.target.value)} /></div>
              {(actionType !== 'suspension' && actionType !== 'license_revocation') && (
                <div><Label>Expiry (days)</Label><Input type="number" value={expiryDays} onChange={e => setExpiryDays(e.target.value)} /></div>
              )}
              {actionType === 'corridor_restriction' && (
                <div className="col-span-2"><Label>Restricted Corridors (comma-separated)</Label><Input placeholder="NG-TR, NG-AE" value={restrictedCorridors} onChange={e => setRestrictedCorridors(e.target.value)} /></div>
              )}
              {actionType === 'limit_override' && (
                <>
                  <div><Label>New Daily Limit (NGN)</Label><Input placeholder="500000000" value={newLimit} onChange={e => setNewLimit(e.target.value)} /></div>
                  <div><Label>New Max Transaction (NGN)</Label><Input placeholder="50000000" value={newTxnMax} onChange={e => setNewTxnMax(e.target.value)} /></div>
                </>
              )}
              {(actionType === 'warning' || actionType === 'show_cause' || actionType === 'remediation_order') && (
                <div className="col-span-2"><Label>Required Actions (one per line)</Label><textarea className="w-full border rounded-md p-2 text-sm min-h-[80px]" placeholder="Action 1&#10;Action 2&#10;Action 3" value={directiveActions} onChange={e => setDirectiveActions(e.target.value)} /></div>
              )}
            </div>
            <div><Label>Reason / Justification</Label><textarea className="w-full border rounded-md p-2 text-sm min-h-[100px]" placeholder="Detailed reason for this enforcement action..." value={actionReason} onChange={e => setActionReason(e.target.value)} /></div>
            <div className="flex gap-2">
              <Button className="bg-red-600 hover:bg-red-700" disabled={!targetParticipant || !actionReason || !actionRef} onClick={handleSubmitAction}>
                <ShieldAlert className="h-4 w-4 mr-1" /> Issue Enforcement Action
              </Button>
              <Button variant="outline" onClick={() => setActiveTab('actions')}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// =============================================================================
// CORRIDORS (Reference Data)
// =============================================================================

function CorridorsSection() {
  const heatmapData = useMemo(() => corridors.map((c, i) => ({
    ...c,
    volume: ((i * 37 + 13) % 500 + 50) * 1000000,
    transfers: (i * 23 + 7) % 200 + 10,
    successRate: (i * 3 + 1) % 8 + 92,
    avgLatency: (i * 157 + 41) % 2000 + 200,
  })), []);
  const maxVol = Math.max(...heatmapData.map(c => c.volume));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Corridors</h1>
        <p className="text-muted-foreground">13 Nigerian corridors with CBN-mandated spread caps</p>
      </div>

      {/* Corridor Heatmap (#6) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Corridor Flow Heatmap</CardTitle>
          <CardDescription>Transfer volume intensity across corridors (darker = higher volume)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-3">
            {heatmapData.map(c => {
              const intensity = c.volume / maxVol;
              const bg = `rgba(59, 130, 246, ${0.1 + intensity * 0.8})`;
              return (
                <Tooltip key={c.id}>
                  <TooltipTrigger asChild>
                    <div className="rounded-lg p-3 cursor-pointer border transition-transform hover:scale-105" style={{ backgroundColor: bg }}>
                      <p className={`font-mono font-bold text-sm ${intensity > 0.5 ? 'text-white' : ''}`}>{c.id}</p>
                      <p className={`text-xs ${intensity > 0.5 ? 'text-blue-100' : 'text-muted-foreground'}`}>{c.dest}</p>
                      <p className={`text-lg font-bold ${intensity > 0.5 ? 'text-white' : ''}`}>₦{(c.volume / 1000000).toFixed(0)}M</p>
                      <p className={`text-xs ${intensity > 0.5 ? 'text-blue-100' : 'text-muted-foreground'}`}>{c.transfers} transfers</p>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-mono">{c.id} ({c.currency})</p>
                    <p>Success: {c.successRate}% · Latency: {c.avgLatency}ms</p>
                    <p>Spread cap: {c.spreadCap} bps</p>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
          <div className="flex items-center gap-2 mt-4 text-xs text-muted-foreground">
            <span>Low</span>
            <div className="flex-1 h-2 rounded-full" style={{ background: 'linear-gradient(to right, rgba(59,130,246,0.1), rgba(59,130,246,0.9))' }} />
            <span>High</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Corridor Details</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Corridor</TableHead><TableHead>Destination</TableHead><TableHead>Currency</TableHead><TableHead>Category</TableHead><TableHead>CBN Spread Cap</TableHead><TableHead>Max (USD)</TableHead></TableRow></TableHeader>
            <TableBody>
              {corridors.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono font-medium">{c.id}</TableCell>
                  <TableCell>{c.dest}</TableCell>
                  <TableCell><Badge variant="outline">{c.currency}</Badge></TableCell>
                  <TableCell>{c.category}</TableCell>
                  <TableCell>{c.spreadCap} bps</TableCell>
                  <TableCell>${c.maxUsd.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// SETTINGS (includes Tier Upgrade)
// =============================================================================

function SettingsSection({ role }: { role: UserRole }) {
  const isAdmin = role === 'admin' || role === 'cbn';
  const { data: tierUpgrades } = trpc.outboundRemittance.listTierUpgrades.useQuery();
  const upgradeMutation = trpc.outboundRemittance.requestTierUpgrade.useMutation();
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeReq, setUpgradeReq] = useState({ requestedTier: 'enterprise' as const, justification: '', monthlyVolume: '' });

  const handleUpgrade = async () => {
    if (!upgradeReq.justification || !upgradeReq.monthlyVolume) return;
    await upgradeMutation.mutateAsync(upgradeReq);
    setShowUpgrade(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">{isAdmin ? 'Platform configuration' : 'Account settings and tier management'}</p>
      </div>

      {!isAdmin && (
        <>
          <Card>
            <CardHeader><CardTitle>Tier Upgrade</CardTitle><CardDescription>Request a higher tier for increased limits and corridor access</CardDescription></CardHeader>
            <CardContent>
              {!showUpgrade ? (
                <Button onClick={() => setShowUpgrade(true)}><ArrowUpCircle className="h-4 w-4 mr-1" /> Request Tier Upgrade</Button>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Requested Tier</Label>
                    <Select value={upgradeReq.requestedTier} onValueChange={(v: any) => setUpgradeReq(p => ({...p, requestedTier: v}))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="growth">Growth</SelectItem><SelectItem value="enterprise">Enterprise</SelectItem><SelectItem value="premium">Premium</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div><Label>Monthly Volume (NGN)</Label><Input value={upgradeReq.monthlyVolume} onChange={e => setUpgradeReq(p => ({...p, monthlyVolume: e.target.value}))} placeholder="e.g. 5000000000" /></div>
                  <div className="col-span-2"><Label>Justification</Label><Input value={upgradeReq.justification} onChange={e => setUpgradeReq(p => ({...p, justification: e.target.value}))} placeholder="Why do you need this tier?" /></div>
                  <div className="col-span-2 flex gap-2">
                    <Button onClick={handleUpgrade} disabled={upgradeMutation.isPending}>Submit Request</Button>
                    <Button variant="outline" onClick={() => setShowUpgrade(false)}>Cancel</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {tierUpgrades && tierUpgrades.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Upgrade History</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>From</TableHead><TableHead>To</TableHead><TableHead>Volume</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {tierUpgrades.map((u: any) => (
                      <TableRow key={u.id}>
                        <TableCell><Badge variant="outline">{u.currentTier}</Badge></TableCell>
                        <TableCell><Badge>{u.requestedTier}</Badge></TableCell>
                        <TableCell>{formatNgn(u.monthlyVolume)}</TableCell>
                        <TableCell><StatusBadge status={u.status} /></TableCell>
                        <TableCell className="text-xs">{new Date(u.createdAt).toLocaleDateString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {isAdmin && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Platform Configuration</CardTitle>
              <CardDescription>Global settings for the outbound remittance switch</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h3 className="font-semibold text-sm">Transfer Limits</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center p-3 border rounded">
                      <div><p className="text-sm font-medium">RTGS Threshold</p><p className="text-xs text-muted-foreground">Transfers above this bypass batching</p></div>
                      <Badge variant="outline">₦500,000,000</Badge>
                    </div>
                    <div className="flex justify-between items-center p-3 border rounded">
                      <div><p className="text-sm font-medium">Dual Approval Threshold</p><p className="text-xs text-muted-foreground">Requires 2 admin approvals above this</p></div>
                      <Badge variant="outline">₦100,000,000</Badge>
                    </div>
                    <div className="flex justify-between items-center p-3 border rounded">
                      <div><p className="text-sm font-medium">Daily Per-Participant Cap</p><p className="text-xs text-muted-foreground">Maximum daily volume per IMTO</p></div>
                      <Badge variant="outline">₦10,000,000,000</Badge>
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <h3 className="font-semibold text-sm">Compliance Settings</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center p-3 border rounded">
                      <div><p className="text-sm font-medium">Sanctions Lists</p><p className="text-xs text-muted-foreground">OFAC, UN, EU, CBN, EFCC</p></div>
                      <Badge className="bg-green-100 text-green-800">5 Active</Badge>
                    </div>
                    <div className="flex justify-between items-center p-3 border rounded">
                      <div><p className="text-sm font-medium">Re-screening Interval</p><p className="text-xs text-muted-foreground">Continuous re-screening of existing beneficiaries</p></div>
                      <Badge variant="outline">24 hours</Badge>
                    </div>
                    <div className="flex justify-between items-center p-3 border rounded">
                      <div><p className="text-sm font-medium">SAR Auto-Filing</p><p className="text-xs text-muted-foreground">Automatic filing to NFIU</p></div>
                      <Badge className="bg-green-100 text-green-800">Enabled</Badge>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>System Health</CardTitle>
              <CardDescription>Infrastructure and middleware status</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { name: 'PostgreSQL', status: 'operational', latency: '2ms' },
                  { name: 'TigerBeetle', status: 'operational', latency: '0.5ms' },
                  { name: 'Redis Cache', status: 'operational', latency: '1ms' },
                  { name: 'Kafka', status: 'operational', latency: '8ms' },
                  { name: 'Keycloak IAM', status: 'operational', latency: '15ms' },
                  { name: 'Temporal', status: 'operational', latency: '5ms' },
                  { name: 'OpenSearch', status: 'operational', latency: '12ms' },
                  { name: 'APISIX Gateway', status: 'operational', latency: '3ms' },
                ].map(svc => (
                  <div key={svc.name} className="border rounded-lg p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{svc.name}</span>
                      <span className="h-2 w-2 rounded-full bg-green-500" />
                    </div>
                    <p className="text-xs text-muted-foreground">{svc.status} • {svc.latency}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notification Preferences</CardTitle>
              <CardDescription>Configure platform-wide alerts and notifications</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { event: 'Transfer SLA Breach', channel: 'Email + SMS', threshold: 'Exceeds corridor SLA target' },
                  { event: 'Prefund Low Balance', channel: 'Email + Push', threshold: 'Below 20% of daily avg volume' },
                  { event: 'Sanctions Hit', channel: 'Email + SMS + Slack', threshold: 'Any match (immediate)' },
                  { event: 'Rail Degradation', channel: 'Email + Slack', threshold: 'Success rate below 95%' },
                  { event: 'High-Value Transfer', channel: 'Email', threshold: 'Above ₦100M (requires dual approval)' },
                  { event: 'New Participant Onboarding', channel: 'Email', threshold: 'Application submitted' },
                ].map((n, i) => (
                  <div key={i} className="flex items-center justify-between p-3 border rounded">
                    <div>
                      <p className="text-sm font-medium">{n.event}</p>
                      <p className="text-xs text-muted-foreground">{n.threshold}</p>
                    </div>
                    <Badge variant="outline" className="text-xs">{n.channel}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Audit & Security</CardTitle>
              <CardDescription>Security configuration and audit settings</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex justify-between items-center p-3 border rounded">
                    <div><p className="text-sm font-medium">FIDO2 Hardware Keys</p><p className="text-xs text-muted-foreground">Required for approvals above ₦100M</p></div>
                    <Badge className="bg-green-100 text-green-800">Enforced</Badge>
                  </div>
                  <div className="flex justify-between items-center p-3 border rounded">
                    <div><p className="text-sm font-medium">Session Timeout</p><p className="text-xs text-muted-foreground">Idle session expiration</p></div>
                    <Badge variant="outline">15 minutes</Badge>
                  </div>
                  <div className="flex justify-between items-center p-3 border rounded">
                    <div><p className="text-sm font-medium">IP Allowlisting</p><p className="text-xs text-muted-foreground">Restrict API access per participant</p></div>
                    <Badge className="bg-green-100 text-green-800">Enabled</Badge>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center p-3 border rounded">
                    <div><p className="text-sm font-medium">Audit Log Retention</p><p className="text-xs text-muted-foreground">Immutable event log (SHA-256 chained)</p></div>
                    <Badge variant="outline">7 years</Badge>
                  </div>
                  <div className="flex justify-between items-center p-3 border rounded">
                    <div><p className="text-sm font-medium">Behavioral Biometrics</p><p className="text-xs text-muted-foreground">Admin session anomaly detection</p></div>
                    <Badge className="bg-green-100 text-green-800">Active</Badge>
                  </div>
                  <div className="flex justify-between items-center p-3 border rounded">
                    <div><p className="text-sm font-medium">Rate Limit (Global)</p><p className="text-xs text-muted-foreground">Platform-wide API throttle</p></div>
                    <Badge variant="outline">10,000 req/min</Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Common settings for all roles */}
      <Card>
        <CardHeader>
          <CardTitle>Account Information</CardTitle>
          <CardDescription>Your account details and role</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between items-center p-3 border rounded">
              <span className="text-sm font-medium">Role</span>
              <Badge>{role === 'admin' ? 'Platform Admin' : role === 'cbn' ? 'CBN Regulator' : 'Participant (IMTO)'}</Badge>
            </div>
            {!isAdmin && (
              <>
                <div className="flex justify-between items-center p-3 border rounded">
                  <span className="text-sm font-medium">Organization</span>
                  <span className="text-sm">PayApp Nigeria Ltd</span>
                </div>
                <div className="flex justify-between items-center p-3 border rounded">
                  <span className="text-sm font-medium">Current Tier</span>
                  <Badge variant="outline">Enterprise</Badge>
                </div>
                <div className="flex justify-between items-center p-3 border rounded">
                  <span className="text-sm font-medium">CBN License</span>
                  <span className="text-sm font-mono text-xs">CBN/IMTO/2024/0012</span>
                </div>
                <div className="flex justify-between items-center p-3 border rounded">
                  <span className="text-sm font-medium">Assigned Corridors</span>
                  <span className="text-sm">NG-GH, NG-GB, NG-US, NG-SN, NG-KE, NG-IN, NG-CN</span>
                </div>
              </>
            )}
            {isAdmin && (
              <div className="flex justify-between items-center p-3 border rounded">
                <span className="text-sm font-medium">Platform Version</span>
                <span className="text-sm">Switch v4.2 • API v2.1 • Last updated May 2026</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// FX MANAGEMENT (Admin Only)
// =============================================================================

function FXManagementSection() {
  const [spreadOverride, setSpreadOverride] = useState({ corridor: '', spreadBps: '', reason: '' });

  const fxRates = [
    { pair: 'NGN/GHS', bid: 0.00190, ask: 0.00210, mid: 0.00200, source: 'Bloomberg', stale: false, updated: '2s ago' },
    { pair: 'NGN/GBP', bid: 0.000780, ask: 0.000804, mid: 0.000792, source: 'Bloomberg', stale: false, updated: '5s ago' },
    { pair: 'NGN/USD', bid: 0.000620, ask: 0.000640, mid: 0.000630, source: 'Bloomberg', stale: false, updated: '3s ago' },
    { pair: 'NGN/EUR', bid: 0.000570, ask: 0.000590, mid: 0.000580, source: 'Reuters', stale: false, updated: '8s ago' },
    { pair: 'NGN/CAD', bid: 0.000830, ask: 0.000860, mid: 0.000845, source: 'Bloomberg', stale: false, updated: '4s ago' },
    { pair: 'NGN/INR', bid: 0.0520, ask: 0.0540, mid: 0.0530, source: 'Bloomberg', stale: false, updated: '6s ago' },
    { pair: 'NGN/CNY', bid: 0.00450, ask: 0.00470, mid: 0.00460, source: 'Reuters', stale: true, updated: '45s ago' },
    { pair: 'NGN/AED', bid: 0.00228, ask: 0.00238, mid: 0.00233, source: 'Bloomberg', stale: false, updated: '2s ago' },
    { pair: 'NGN/KES', bid: 0.0800, ask: 0.0830, mid: 0.0815, source: 'CBN Official', stale: false, updated: '1h ago' },
    { pair: 'NGN/ZAR', bid: 0.01120, ask: 0.01160, mid: 0.01140, source: 'Bloomberg', stale: false, updated: '7s ago' },
    { pair: 'NGN/XOF', bid: 0.3650, ask: 0.3750, mid: 0.3700, source: 'CBN Official', stale: false, updated: '30m ago' },
    { pair: 'NGN/TRY', bid: 0.0210, ask: 0.0220, mid: 0.0215, source: 'Reuters', stale: false, updated: '12s ago' },
  ];

  const spreadConfigs = corridors.map(c => ({
    corridor: c.id,
    cbnCap: c.spreadCap,
    platformSpread: Math.round(c.spreadCap * 0.7),
    effectiveSpread: Math.round(c.spreadCap * 0.7),
    overrideActive: false,
  }));

  const auditEntries = [
    { time: '14:32:05', action: 'rate_update', corridor: 'NGN/GHS', detail: 'Mid: 0.001998 → 0.002000', source: 'Bloomberg' },
    { time: '14:31:52', action: 'rate_update', corridor: 'NGN/USD', detail: 'Mid: 0.000628 → 0.000630', source: 'Bloomberg' },
    { time: '14:28:00', action: 'spread_change', corridor: 'NG-GH', detail: 'Spread: 60 → 50 bps (promotional)', source: 'admin@cbn.gov.ng' },
    { time: '13:15:00', action: 'cbn_rate_update', corridor: 'NGN/KES', detail: 'Official rate published', source: 'CBN Feed' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">FX Rate Management</h1>
          <p className="text-muted-foreground">Bloomberg/Reuters integration, CBN spread caps, rate overrides</p>
        </div>
        <div className="flex gap-2">
          <Badge className="bg-green-600">Live Feed Active</Badge>
          <Button variant="destructive" size="sm">Freeze All Rates</Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card><CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">Active Rate Sources</p>
          <p className="text-2xl font-bold">3</p>
          <p className="text-xs text-muted-foreground">Bloomberg, Reuters, CBN</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">Stale Rates</p>
          <p className="text-2xl font-bold text-yellow-500">1</p>
          <p className="text-xs text-muted-foreground">NGN/CNY ({'>'}30s old)</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">Active Overrides</p>
          <p className="text-2xl font-bold">0</p>
          <p className="text-xs text-muted-foreground">No manual adjustments</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">Rate Freeze Status</p>
          <p className="text-2xl font-bold text-green-500">Normal</p>
          <p className="text-xs text-muted-foreground">All rates updating</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Live FX Rates</CardTitle><CardDescription>Real-time feeds from Bloomberg B-PIPE, Reuters, CBN</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Pair</TableHead><TableHead>Bid</TableHead><TableHead>Ask</TableHead><TableHead>Mid</TableHead>
              <TableHead>Source</TableHead><TableHead>Status</TableHead><TableHead>Updated</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {fxRates.map(r => (
                <TableRow key={r.pair}>
                  <TableCell className="font-mono font-medium">{r.pair}</TableCell>
                  <TableCell className="font-mono">{r.bid.toFixed(6)}</TableCell>
                  <TableCell className="font-mono">{r.ask.toFixed(6)}</TableCell>
                  <TableCell className="font-mono font-medium">{r.mid.toFixed(6)}</TableCell>
                  <TableCell><Badge variant="outline">{r.source}</Badge></TableCell>
                  <TableCell>{r.stale ? <Badge variant="destructive">Stale</Badge> : <Badge className="bg-green-600">Live</Badge>}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.updated}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Corridor Spread Configuration</CardTitle><CardDescription>CBN-mandated spread caps and platform pricing</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Corridor</TableHead><TableHead>CBN Cap (bps)</TableHead><TableHead>Platform Spread (bps)</TableHead>
              <TableHead>Effective (bps)</TableHead><TableHead>Override</TableHead><TableHead>Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {spreadConfigs.map(s => (
                <TableRow key={s.corridor}>
                  <TableCell className="font-medium">{s.corridor}</TableCell>
                  <TableCell>{s.cbnCap}</TableCell>
                  <TableCell>{s.platformSpread}</TableCell>
                  <TableCell className="font-medium">{s.effectiveSpread}</TableCell>
                  <TableCell>{s.overrideActive ? <Badge variant="destructive">Active</Badge> : <Badge variant="outline">None</Badge>}</TableCell>
                  <TableCell><Button size="sm" variant="outline">Adjust</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Apply Spread Override</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <Label>Corridor</Label>
              <Select value={spreadOverride.corridor} onValueChange={v => setSpreadOverride(p => ({...p, corridor: v}))}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{corridors.map(c => <SelectItem key={c.id} value={c.id}>{c.id}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Spread (bps)</Label><Input type="number" value={spreadOverride.spreadBps} onChange={e => setSpreadOverride(p => ({...p, spreadBps: e.target.value}))} placeholder="e.g. 50" /></div>
            <div><Label>Reason</Label><Input value={spreadOverride.reason} onChange={e => setSpreadOverride(p => ({...p, reason: e.target.value}))} placeholder="e.g. Q2 promotion" /></div>
            <div className="flex items-end"><Button>Apply Override</Button></div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Override cannot exceed CBN spread cap. All changes audited.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>FX Audit Log</CardTitle><CardDescription>All rate changes, overrides, and freeze events</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Action</TableHead><TableHead>Corridor</TableHead><TableHead>Detail</TableHead><TableHead>Source</TableHead></TableRow></TableHeader>
            <TableBody>
              {auditEntries.map((e, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">{e.time}</TableCell>
                  <TableCell><Badge variant="outline">{e.action}</Badge></TableCell>
                  <TableCell>{e.corridor}</TableCell>
                  <TableCell className="text-sm">{e.detail}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{e.source}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// TIER MANAGEMENT (Admin Only)
// =============================================================================

function TierManagementSection() {
  const tiers = [
    { name: 'Starter', fee: '$200/mo', txnFee: '₦1,500', fxDiscount: '0%', corridors: 3, volume: '< ₦1B/mo', participants: 3 },
    { name: 'Growth', fee: '$500/mo', txnFee: '₦1,000', fxDiscount: '10%', corridors: 7, volume: '₦1B–₦5B/mo', participants: 3 },
    { name: 'Enterprise', fee: '$2,000/mo', txnFee: '₦500', fxDiscount: '25%', corridors: 13, volume: '₦5B–₦10B/mo', participants: 1 },
    { name: 'Premium', fee: '$5,000/mo', txnFee: '₦250', fxDiscount: '40%', corridors: 13, volume: '> ₦10B/mo', participants: 1 },
  ];

  const promotionCriteria = [
    { from: 'Starter', to: 'Growth', minVolume: '₦1B avg 3-month', minMonths: 3, maxSanctionsBlocks: 2, minSuccess: '95%', minPrefund: '80%' },
    { from: 'Growth', to: 'Enterprise', minVolume: '₦5B avg 3-month', minMonths: 6, maxSanctionsBlocks: 1, minSuccess: '97%', minPrefund: '90%' },
    { from: 'Enterprise', to: 'Premium', minVolume: '₦10B avg 3-month', minMonths: 12, maxSanctionsBlocks: 0, minSuccess: '99%', minPrefund: '95%' },
  ];

  const pendingEvaluations = [
    { participant: 'OPay Nigeria', current: 'Growth', proposed: 'Enterprise', volume: '₦6.2B', success: '97.8%', months: 8, reason: 'Auto-evaluated: volume exceeds threshold' },
    { participant: 'Moniepoint', current: 'Starter', proposed: 'Growth', volume: '₦1.8B', success: '96.1%', months: 5, reason: 'Auto-evaluated: 3-month criteria met' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Tier Management</h1>
        <p className="text-muted-foreground">Automated tier determination based on volume, compliance, and platform tenure</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Tier Definitions</CardTitle><CardDescription>Subscription tiers with pricing and corridor access</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Tier</TableHead><TableHead>Monthly Fee</TableHead><TableHead>Txn Fee</TableHead>
              <TableHead>FX Discount</TableHead><TableHead>Max Corridors</TableHead><TableHead>Volume Band</TableHead><TableHead>Participants</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {tiers.map(t => (
                <TableRow key={t.name}>
                  <TableCell><Badge variant={t.name === 'Premium' ? 'default' : 'outline'}>{t.name}</Badge></TableCell>
                  <TableCell>{t.fee}</TableCell>
                  <TableCell>{t.txnFee}</TableCell>
                  <TableCell>{t.fxDiscount}</TableCell>
                  <TableCell>{t.corridors}</TableCell>
                  <TableCell>{t.volume}</TableCell>
                  <TableCell className="font-bold">{t.participants}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Auto-Promotion Criteria</CardTitle><CardDescription>System evaluates participants monthly against these thresholds</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Transition</TableHead><TableHead>Min Volume (3mo avg)</TableHead><TableHead>Min Months</TableHead>
              <TableHead>Max Sanctions Blocks (90d)</TableHead><TableHead>Min Success Rate</TableHead><TableHead>Min Prefund Consistency</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {promotionCriteria.map(c => (
                <TableRow key={c.to}>
                  <TableCell><span>{c.from}</span> → <Badge>{c.to}</Badge></TableCell>
                  <TableCell>{c.minVolume}</TableCell>
                  <TableCell>{c.minMonths}</TableCell>
                  <TableCell>{c.maxSanctionsBlocks}</TableCell>
                  <TableCell>{c.minSuccess}</TableCell>
                  <TableCell>{c.minPrefund}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending Tier Evaluations</CardTitle>
          <CardDescription>Auto-generated upgrade/downgrade proposals requiring admin approval</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Participant</TableHead><TableHead>Current</TableHead><TableHead>Proposed</TableHead>
              <TableHead>Volume</TableHead><TableHead>Success</TableHead><TableHead>Months</TableHead><TableHead>Reason</TableHead><TableHead>Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {pendingEvaluations.map((e, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{e.participant}</TableCell>
                  <TableCell><Badge variant="outline">{e.current}</Badge></TableCell>
                  <TableCell><Badge>{e.proposed}</Badge></TableCell>
                  <TableCell>{e.volume}</TableCell>
                  <TableCell>{e.success}</TableCell>
                  <TableCell>{e.months}</TableCell>
                  <TableCell className="text-xs max-w-[200px] truncate">{e.reason}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm">Approve</Button>
                      <Button size="sm" variant="destructive">Reject</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// PAYMENT RAILS — SWIFT, PAPSS, CIPS, UPI, SEPA, Mobile Money, ACH, FPS
// Integrated with Mojaloop Hub Router
// =============================================================================

function PaymentRailsSection({ isAdmin }: { isAdmin: boolean }) {
  const [railsTab, setRailsTab] = useState<'overview' | 'corridorRouting' | 'dfsps' | 'feeCalculator'>('overview');
  const [showCreateRail, setShowCreateRail] = useState(false);
  const [editingRail, setEditingRail] = useState<string | null>(null);
  const [showCreateRoute, setShowCreateRoute] = useState(false);
  const [editingRoute, setEditingRoute] = useState<string | null>(null);
  const [showCreateDFSP, setShowCreateDFSP] = useState(false);
  const [editingDFSP, setEditingDFSP] = useState<string | null>(null);
  const [changingStatus, setChangingStatus] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const railsQuery = trpc.outboundRemittance.getPaymentRails.useQuery();
  const statusesQuery = trpc.outboundRemittance.getRailStatuses.useQuery();
  const routingQuery = trpc.outboundRemittance.getCorridorRouting.useQuery();
  const dfspsQuery = trpc.outboundRemittance.getDFSPRegistry.useQuery();

  const invalidateAll = () => {
    utils.outboundRemittance.getPaymentRails.invalidate();
    utils.outboundRemittance.getRailStatuses.invalidate();
    utils.outboundRemittance.getCorridorRouting.invalidate();
    utils.outboundRemittance.getDFSPRegistry.invalidate();
  };

  const createRailMut = trpc.outboundRemittance.createRail.useMutation({ onSuccess: () => { invalidateAll(); setShowCreateRail(false); } });
  const updateRailMut = trpc.outboundRemittance.updateRail.useMutation({ onSuccess: () => { invalidateAll(); setEditingRail(null); } });
  const deleteRailMut = trpc.outboundRemittance.deleteRail.useMutation({ onSuccess: invalidateAll });
  const updateStatusMut = trpc.outboundRemittance.updateRailStatus.useMutation({ onSuccess: () => { invalidateAll(); setChangingStatus(null); } });
  const createRouteMut = trpc.outboundRemittance.createCorridorRoute.useMutation({ onSuccess: () => { invalidateAll(); setShowCreateRoute(false); } });
  const updateRouteMut = trpc.outboundRemittance.updateCorridorRoute.useMutation({ onSuccess: () => { invalidateAll(); setEditingRoute(null); } });
  const deleteRouteMut = trpc.outboundRemittance.deleteCorridorRoute.useMutation({ onSuccess: invalidateAll });
  const createDFSPMut = trpc.outboundRemittance.createDFSP.useMutation({ onSuccess: () => { invalidateAll(); setShowCreateDFSP(false); } });
  const updateDFSPMut = trpc.outboundRemittance.updateDFSP.useMutation({ onSuccess: () => { invalidateAll(); setEditingDFSP(null); } });
  const deleteDFSPMut = trpc.outboundRemittance.deleteDFSP.useMutation({ onSuccess: invalidateAll });

  const rails: any[] = Array.isArray(railsQuery.data) ? railsQuery.data : [];
  const statuses: any[] = Array.isArray(statusesQuery.data) ? statusesQuery.data : [];
  const routing: any[] = Array.isArray(routingQuery.data) ? routingQuery.data : [];
  const dfsps: any[] = Array.isArray(dfspsQuery.data) ? dfspsQuery.data : [];
  const railTypes = rails.map(r => r.type);

  const railStatusColor = (s: string) => {
    if (s === 'operational') return 'default' as const;
    if (s === 'degraded') return 'secondary' as const;
    return 'destructive' as const;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Payment Rails & Mojaloop Hub</h2>
        <p className="text-sm text-muted-foreground">{rails.length} payment rails integrated via Mojaloop interoperability hub. Rail selection per corridor with automatic fallback.</p>
      </div>

      <div className="flex gap-2 border-b pb-2">
        {(['overview', 'corridorRouting', 'dfsps', 'feeCalculator'] as const).map(tab => (
          <button key={tab} onClick={() => setRailsTab(tab)}
            className={`px-3 py-1.5 text-sm rounded-md ${railsTab === tab ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
            {tab === 'overview' ? 'Rail Status' : tab === 'corridorRouting' ? 'Corridor Routing' : tab === 'dfsps' ? 'DFSP Registry' : 'Fee Calculator'}
          </button>
        ))}
      </div>

      {/* ============ RAIL STATUS OVERVIEW ============ */}
      {railsTab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{statuses.length}</div><p className="text-xs text-muted-foreground">Active Rails</p></CardContent></Card>
            <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{statuses.filter(s => s.status === 'operational').length}</div><p className="text-xs text-muted-foreground">Operational</p></CardContent></Card>
            <Card><CardContent className="pt-4"><div className="text-2xl font-bold">${(statuses.reduce((sum, s) => sum + s.dailyVolumeUSD, 0) / 1_000_000).toFixed(1)}M</div><p className="text-xs text-muted-foreground">24h Volume (All Rails)</p></CardContent></Card>
          </div>

          {isAdmin && <div className="flex justify-end"><Button size="sm" onClick={() => setShowCreateRail(true)}><Plus className="h-4 w-4 mr-1" /> Add Rail</Button></div>}

          {/* Create Rail Form */}
          {showCreateRail && isAdmin && (
            <Card className="border-blue-300">
              <CardHeader><CardTitle className="text-base">Add New Payment Rail</CardTitle></CardHeader>
              <CardContent>
                <form onSubmit={e => { e.preventDefault(); const fd = new FormData(e.currentTarget);
                  createRailMut.mutate({ type: fd.get('type') as string, name: fd.get('name') as string, settlementCurrency: fd.get('settlementCurrency') as string, messageFormat: fd.get('messageFormat') as string, maxSettlement: fd.get('maxSettlement') as string, tracking: fd.get('tracking') === 'true', corridors: (fd.get('corridors') as string).split(',').map(s => s.trim()).filter(Boolean), description: fd.get('description') as string });
                }} className="grid grid-cols-2 gap-3">
                  <div><Label>Type (e.g. SWIFT_V2)</Label><Input name="type" required /></div>
                  <div><Label>Name</Label><Input name="name" required /></div>
                  <div><Label>Settlement Currency</Label><Input name="settlementCurrency" required /></div>
                  <div><Label>Message Format</Label><Input name="messageFormat" required /></div>
                  <div><Label>Max Settlement</Label><Input name="maxSettlement" required placeholder="e.g. 48h, 30s, 5min" /></div>
                  <div><Label>Tracking</Label><Select name="tracking" defaultValue="true"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="true">Yes</SelectItem><SelectItem value="false">No</SelectItem></SelectContent></Select></div>
                  <div className="col-span-2"><Label>Corridors (comma-separated)</Label><Input name="corridors" required placeholder="NG-GH, NG-US" /></div>
                  <div className="col-span-2"><Label>Description</Label><Input name="description" required /></div>
                  <div className="col-span-2 flex gap-2"><Button type="submit" disabled={createRailMut.isPending}>{createRailMut.isPending ? 'Creating...' : 'Create Rail'}</Button><Button type="button" variant="outline" onClick={() => setShowCreateRail(false)}>Cancel</Button></div>
                  {createRailMut.error && <p className="col-span-2 text-sm text-destructive">{createRailMut.error.message}</p>}
                </form>
              </CardContent>
            </Card>
          )}

          {/* Rail Table */}
          <Card>
            <CardHeader><CardTitle>Payment Rail Network Status</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rail</TableHead><TableHead>Type</TableHead><TableHead>Settlement</TableHead><TableHead>Format</TableHead><TableHead>Max Settlement</TableHead><TableHead>Status</TableHead><TableHead>Latency</TableHead><TableHead>Success</TableHead><TableHead>24h Volume</TableHead>
                    {isAdmin && <TableHead>Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rails.map((rail) => {
                    const status = statuses.find(s => s.rail === rail.type);
                    if (editingRail === rail.type && isAdmin) {
                      return (
                        <TableRow key={rail.type}>
                          <TableCell colSpan={10}>
                            <form onSubmit={e => { e.preventDefault(); const fd = new FormData(e.currentTarget);
                              updateRailMut.mutate({ type: rail.type, name: fd.get('name') as string, settlementCurrency: fd.get('settlementCurrency') as string, messageFormat: fd.get('messageFormat') as string, maxSettlement: fd.get('maxSettlement') as string, corridors: (fd.get('corridors') as string).split(',').map(s => s.trim()).filter(Boolean), description: fd.get('description') as string });
                            }} className="flex flex-wrap gap-2 items-end">
                              <div><Label className="text-xs">Name</Label><Input name="name" defaultValue={rail.name} className="h-8 w-40" /></div>
                              <div><Label className="text-xs">Currency</Label><Input name="settlementCurrency" defaultValue={rail.settlementCurrency} className="h-8 w-20" /></div>
                              <div><Label className="text-xs">Format</Label><Input name="messageFormat" defaultValue={rail.messageFormat} className="h-8 w-36" /></div>
                              <div><Label className="text-xs">Max Settlement</Label><Input name="maxSettlement" defaultValue={rail.maxSettlement} className="h-8 w-20" /></div>
                              <div><Label className="text-xs">Corridors</Label><Input name="corridors" defaultValue={rail.corridors.join(', ')} className="h-8 w-48" /></div>
                              <div><Label className="text-xs">Description</Label><Input name="description" defaultValue={rail.description} className="h-8 w-64" /></div>
                              <Button type="submit" size="sm" disabled={updateRailMut.isPending}>Save</Button>
                              <Button type="button" size="sm" variant="outline" onClick={() => setEditingRail(null)}>Cancel</Button>
                              {updateRailMut.error && <p className="text-xs text-destructive">{updateRailMut.error.message}</p>}
                            </form>
                          </TableCell>
                        </TableRow>
                      );
                    }
                    return (
                      <TableRow key={rail.type}>
                        <TableCell className="font-medium">{rail.name}</TableCell>
                        <TableCell><Badge variant="outline">{rail.type}</Badge></TableCell>
                        <TableCell>{rail.settlementCurrency}</TableCell>
                        <TableCell className="text-xs">{rail.messageFormat}</TableCell>
                        <TableCell>{rail.maxSettlement}</TableCell>
                        <TableCell>
                          {changingStatus === rail.type && isAdmin ? (
                            <Select defaultValue={status?.status ?? 'operational'} onValueChange={v => updateStatusMut.mutate({ rail: rail.type, status: v as 'operational' | 'degraded' | 'down' | 'maintenance' })}>
                              <SelectTrigger className="h-7 w-32"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="operational">Operational</SelectItem>
                                <SelectItem value="degraded">Degraded</SelectItem>
                                <SelectItem value="down">Down</SelectItem>
                                <SelectItem value="maintenance">Maintenance</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant={railStatusColor(status?.status ?? 'unknown')} className={isAdmin ? 'cursor-pointer' : ''} onClick={() => isAdmin && setChangingStatus(rail.type)}>{status?.status ?? 'unknown'}</Badge>
                          )}
                        </TableCell>
                        <TableCell>{status?.avgLatencyMs ?? 0}ms</TableCell>
                        <TableCell>{status?.successRate24h?.toFixed(1) ?? 0}%</TableCell>
                        <TableCell>${((status?.dailyVolumeUSD ?? 0) / 1000).toFixed(0)}K</TableCell>
                        {isAdmin && (
                          <TableCell>
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditingRail(rail.type)}>Edit</Button>
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive" onClick={() => { if (confirm(`Delete rail ${rail.type}?`)) deleteRailMut.mutate({ type: rail.type }); }}>Delete</Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {deleteRailMut.error && <p className="text-sm text-destructive mt-2">{deleteRailMut.error.message}</p>}
            </CardContent>
          </Card>

          <div className="grid grid-cols-3 gap-3">
            {rails.map(rail => (
              <Card key={rail.type}>
                <CardHeader className="pb-2"><CardTitle className="text-sm">{rail.name}</CardTitle><Badge variant="outline" className="w-fit">{rail.corridors.length} corridors</Badge></CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">{rail.description}</p>
                  <div className="mt-2 flex flex-wrap gap-1">{rail.corridors.map((c: string) => <Badge key={c} variant="secondary" className="text-xs">{c}</Badge>)}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ============ CORRIDOR ROUTING ============ */}
      {railsTab === 'corridorRouting' && (
        <Card>
          <CardHeader>
            <div className="flex justify-between items-start">
              <div><CardTitle>Corridor-to-Rail Routing Configuration</CardTitle><CardDescription>Per architecture doc §12.4: CorridorFee = PrincipalAmount × CorridorRate(dest, rail) + FixedFee</CardDescription></div>
              {isAdmin && <Button size="sm" onClick={() => setShowCreateRoute(true)}><Plus className="h-4 w-4 mr-1" /> Add Route</Button>}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {showCreateRoute && isAdmin && (
              <Card className="border-blue-300">
                <CardContent className="pt-4">
                  <form onSubmit={e => { e.preventDefault(); const fd = new FormData(e.currentTarget);
                    createRouteMut.mutate({ corridorId: fd.get('corridorId') as string, primaryRail: fd.get('primaryRail') as string, fallbackRails: (fd.get('fallbackRails') as string).split(',').map(s => s.trim()).filter(Boolean), railFeeRate: Number(fd.get('railFeeRate')), railFixedFee: Number(fd.get('railFixedFee')) });
                  }} className="grid grid-cols-3 gap-3">
                    <div><Label>Corridor ID</Label><Input name="corridorId" required placeholder="e.g. NG-JP" /></div>
                    <div><Label>Primary Rail</Label><Select name="primaryRail"><SelectTrigger><SelectValue placeholder="Select rail" /></SelectTrigger><SelectContent>{railTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
                    <div><Label>Fallback Rails (comma-separated)</Label><Input name="fallbackRails" placeholder="SWIFT, ACH" /></div>
                    <div><Label>Fee Rate (decimal, e.g. 0.001)</Label><Input name="railFeeRate" type="number" step="0.0001" required /></div>
                    <div><Label>Fixed Fee (USD)</Label><Input name="railFixedFee" type="number" step="0.01" required /></div>
                    <div className="flex items-end gap-2"><Button type="submit" disabled={createRouteMut.isPending}>{createRouteMut.isPending ? 'Creating...' : 'Create Route'}</Button><Button type="button" variant="outline" onClick={() => setShowCreateRoute(false)}>Cancel</Button></div>
                    {createRouteMut.error && <p className="col-span-3 text-sm text-destructive">{createRouteMut.error.message}</p>}
                  </form>
                </CardContent>
              </Card>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Corridor</TableHead><TableHead>Primary Rail</TableHead><TableHead>Fallback Rails</TableHead><TableHead>Fee Rate</TableHead><TableHead>Fixed Fee</TableHead><TableHead>$1K Fee</TableHead><TableHead>$10K Fee</TableHead>
                  {isAdmin && <TableHead>Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {routing.map(route => {
                  if (editingRoute === route.corridorId && isAdmin) {
                    return (
                      <TableRow key={route.corridorId}>
                        <TableCell colSpan={8}>
                          <form onSubmit={e => { e.preventDefault(); const fd = new FormData(e.currentTarget);
                            updateRouteMut.mutate({ corridorId: route.corridorId, primaryRail: fd.get('primaryRail') as string, fallbackRails: (fd.get('fallbackRails') as string).split(',').map(s => s.trim()).filter(Boolean), railFeeRate: Number(fd.get('railFeeRate')), railFixedFee: Number(fd.get('railFixedFee')) });
                          }} className="flex flex-wrap gap-2 items-end">
                            <div><Label className="text-xs">Corridor</Label><Input value={route.corridorId} disabled className="h-8 w-24" /></div>
                            <div><Label className="text-xs">Primary Rail</Label><Input name="primaryRail" defaultValue={route.primaryRail} className="h-8 w-28" /></div>
                            <div><Label className="text-xs">Fallback Rails</Label><Input name="fallbackRails" defaultValue={route.fallbackRails.join(', ')} className="h-8 w-44" /></div>
                            <div><Label className="text-xs">Fee Rate</Label><Input name="railFeeRate" type="number" step="0.0001" defaultValue={route.railFeeRate} className="h-8 w-24" /></div>
                            <div><Label className="text-xs">Fixed Fee</Label><Input name="railFixedFee" type="number" step="0.01" defaultValue={route.railFixedFee} className="h-8 w-24" /></div>
                            <Button type="submit" size="sm" disabled={updateRouteMut.isPending}>Save</Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => setEditingRoute(null)}>Cancel</Button>
                            {updateRouteMut.error && <p className="text-xs text-destructive">{updateRouteMut.error.message}</p>}
                          </form>
                        </TableCell>
                      </TableRow>
                    );
                  }
                  return (
                    <TableRow key={route.corridorId}>
                      <TableCell className="font-medium">{route.corridorId}</TableCell>
                      <TableCell><Badge>{route.primaryRail}</Badge></TableCell>
                      <TableCell><div className="flex gap-1">{route.fallbackRails.length > 0 ? route.fallbackRails.map((r: string) => <Badge key={r} variant="outline" className="text-xs">{r}</Badge>) : <span className="text-xs text-muted-foreground">none</span>}</div></TableCell>
                      <TableCell>{(route.railFeeRate * 100).toFixed(2)}%</TableCell>
                      <TableCell>${route.railFixedFee.toFixed(2)}</TableCell>
                      <TableCell className="text-green-600">${(1000 * route.railFeeRate + route.railFixedFee).toFixed(2)}</TableCell>
                      <TableCell className="text-green-600">${(10000 * route.railFeeRate + route.railFixedFee).toFixed(2)}</TableCell>
                      {isAdmin && (
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditingRoute(route.corridorId)}>Edit</Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive" onClick={() => { if (confirm(`Delete route ${route.corridorId}?`)) deleteRouteMut.mutate({ corridorId: route.corridorId }); }}>Delete</Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {deleteRouteMut.error && <p className="text-sm text-destructive mt-2">{deleteRouteMut.error.message}</p>}
          </CardContent>
        </Card>
      )}

      {/* ============ DFSP REGISTRY ============ */}
      {railsTab === 'dfsps' && (
        <Card>
          <CardHeader>
            <div className="flex justify-between items-start">
              <div><CardTitle>Mojaloop DFSP Registry</CardTitle><CardDescription>All payment rails registered as Digital Financial Service Providers in the Mojaloop hub</CardDescription></div>
              {isAdmin && <Button size="sm" onClick={() => setShowCreateDFSP(true)}><Plus className="h-4 w-4 mr-1" /> Register DFSP</Button>}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {showCreateDFSP && isAdmin && (
              <Card className="border-blue-300">
                <CardContent className="pt-4">
                  <form onSubmit={e => { e.preventDefault(); const fd = new FormData(e.currentTarget);
                    createDFSPMut.mutate({ dfspId: fd.get('dfspId') as string, name: fd.get('name') as string, railType: fd.get('railType') as string, corridors: (fd.get('corridors') as string).split(',').map(s => s.trim()).filter(Boolean), status: (fd.get('status') as 'active' | 'inactive' | 'suspended'), settlementModel: (fd.get('settlementModel') as 'deferred_net' | 'immediate_gross'), partyIdTypes: (fd.get('partyIdTypes') as string).split(',').map(s => s.trim()).filter(Boolean), endpoint: fd.get('endpoint') as string, settlementAcct: fd.get('settlementAcct') as string });
                  }} className="grid grid-cols-3 gap-3">
                    <div><Label>DFSP ID</Label><Input name="dfspId" required placeholder="e.g. dfsp-newrail" /></div>
                    <div><Label>Name</Label><Input name="name" required /></div>
                    <div><Label>Rail Type</Label><Select name="railType"><SelectTrigger><SelectValue placeholder="Select rail" /></SelectTrigger><SelectContent>{railTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
                    <div><Label>Status</Label><Select name="status" defaultValue="active"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem><SelectItem value="suspended">Suspended</SelectItem></SelectContent></Select></div>
                    <div><Label>Settlement Model</Label><Select name="settlementModel" defaultValue="deferred_net"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="deferred_net">Deferred Net</SelectItem><SelectItem value="immediate_gross">Immediate Gross</SelectItem></SelectContent></Select></div>
                    <div><Label>Party ID Types (comma-separated)</Label><Input name="partyIdTypes" required placeholder="IBAN, MSISDN" /></div>
                    <div><Label>Corridors (comma-separated)</Label><Input name="corridors" required placeholder="NG-GH, NG-US" /></div>
                    <div><Label>Endpoint URL</Label><Input name="endpoint" required placeholder="swift-adapter.remit-switch.internal" /></div>
                    <div><Label>Settlement Account</Label><Input name="settlementAcct" required /></div>
                    <div className="col-span-3 flex gap-2"><Button type="submit" disabled={createDFSPMut.isPending}>{createDFSPMut.isPending ? 'Registering...' : 'Register DFSP'}</Button><Button type="button" variant="outline" onClick={() => setShowCreateDFSP(false)}>Cancel</Button></div>
                    {createDFSPMut.error && <p className="col-span-3 text-sm text-destructive">{createDFSPMut.error.message}</p>}
                  </form>
                </CardContent>
              </Card>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>DFSP ID</TableHead><TableHead>Name</TableHead><TableHead>Rail Type</TableHead><TableHead>Status</TableHead><TableHead>Settlement Model</TableHead><TableHead>Party ID Types</TableHead><TableHead>Corridors</TableHead>
                  {isAdmin && <TableHead>Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {dfsps.map(dfsp => {
                  if (editingDFSP === dfsp.dfspId && isAdmin) {
                    return (
                      <TableRow key={dfsp.dfspId}>
                        <TableCell colSpan={8}>
                          <form onSubmit={e => { e.preventDefault(); const fd = new FormData(e.currentTarget);
                            updateDFSPMut.mutate({ dfspId: dfsp.dfspId, name: fd.get('name') as string, status: fd.get('status') as 'active' | 'inactive' | 'suspended', corridors: (fd.get('corridors') as string).split(',').map(s => s.trim()).filter(Boolean), partyIdTypes: (fd.get('partyIdTypes') as string).split(',').map(s => s.trim()).filter(Boolean), endpoint: fd.get('endpoint') as string, settlementAcct: fd.get('settlementAcct') as string });
                          }} className="flex flex-wrap gap-2 items-end">
                            <div><Label className="text-xs">DFSP ID</Label><Input value={dfsp.dfspId} disabled className="h-8 w-36" /></div>
                            <div><Label className="text-xs">Name</Label><Input name="name" defaultValue={dfsp.name} className="h-8 w-40" /></div>
                            <div><Label className="text-xs">Status</Label><select name="status" defaultValue={dfsp.status} className="h-8 border rounded px-2 text-xs"><option value="active">Active</option><option value="inactive">Inactive</option><option value="suspended">Suspended</option></select></div>
                            <div><Label className="text-xs">Corridors</Label><Input name="corridors" defaultValue={dfsp.corridors.join(', ')} className="h-8 w-48" /></div>
                            <div><Label className="text-xs">Party ID Types</Label><Input name="partyIdTypes" defaultValue={dfsp.partyIdTypes.join(', ')} className="h-8 w-36" /></div>
                            <div><Label className="text-xs">Endpoint</Label><Input name="endpoint" defaultValue={dfsp.endpoint} className="h-8 w-56" /></div>
                            <div><Label className="text-xs">Settlement Acct</Label><Input name="settlementAcct" defaultValue={dfsp.settlementAcct} className="h-8 w-36" /></div>
                            <Button type="submit" size="sm" disabled={updateDFSPMut.isPending}>Save</Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => setEditingDFSP(null)}>Cancel</Button>
                            {updateDFSPMut.error && <p className="text-xs text-destructive">{updateDFSPMut.error.message}</p>}
                          </form>
                        </TableCell>
                      </TableRow>
                    );
                  }
                  return (
                    <TableRow key={dfsp.dfspId}>
                      <TableCell className="font-mono text-xs">{dfsp.dfspId}</TableCell>
                      <TableCell className="font-medium">{dfsp.name}</TableCell>
                      <TableCell><Badge>{dfsp.railType}</Badge></TableCell>
                      <TableCell><Badge variant={dfsp.status === 'active' ? 'default' : 'destructive'}>{dfsp.status}</Badge></TableCell>
                      <TableCell className="text-xs">{dfsp.settlementModel}</TableCell>
                      <TableCell><div className="flex gap-1">{dfsp.partyIdTypes.map((t: string) => <Badge key={t} variant="outline" className="text-xs">{t}</Badge>)}</div></TableCell>
                      <TableCell className="text-xs">{dfsp.corridors.join(', ')}</TableCell>
                      {isAdmin && (
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditingDFSP(dfsp.dfspId)}>Edit</Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive" onClick={() => { if (confirm(`Deregister DFSP ${dfsp.dfspId}?`)) deleteDFSPMut.mutate({ dfspId: dfsp.dfspId }); }}>Delete</Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {deleteDFSPMut.error && <p className="text-sm text-destructive mt-2">{deleteDFSPMut.error.message}</p>}
          </CardContent>
        </Card>
      )}

      {railsTab === 'feeCalculator' && <FeeCalculatorPanel />}
    </div>
  );
}

function FeeCalculatorPanel() {
  const [selectedCorridor, setSelectedCorridor] = useState('NG-GH');
  const [principal, setPrincipal] = useState(1000);
  const feeQuery = trpc.outboundRemittance.calculateCorridorFee.useQuery(
    { corridorId: selectedCorridor, principalUSD: principal },
    { enabled: principal > 0 }
  );

  return (
    <div className="grid grid-cols-2 gap-4">
      <Card>
        <CardHeader><CardTitle>Rail-Aware Fee Calculator</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Corridor</Label>
            <Select value={selectedCorridor} onValueChange={setSelectedCorridor}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {corridors.map(c => <SelectItem key={c.id} value={c.id}>{c.id} — {c.dest} ({c.currency})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Principal Amount (USD)</Label>
            <Input type="number" value={principal} onChange={e => setPrincipal(Number(e.target.value))} min={1} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Fee Breakdown</CardTitle></CardHeader>
        <CardContent>
          {feeQuery.data ? (
            <div className="space-y-3">
              <div className="flex justify-between"><span className="text-muted-foreground">Corridor</span><span className="font-medium">{feeQuery.data.corridorId}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Rail</span><Badge>{feeQuery.data.railType}</Badge></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Rail Name</span><span>{feeQuery.data.railName}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Principal</span><span>${feeQuery.data.principalUSD.toLocaleString()}</span></div>
              <hr />
              <div className="flex justify-between text-lg font-bold"><span>Corridor Fee</span><span className="text-green-600">${feeQuery.data.corridorFee.toFixed(2)}</span></div>
              <p className="text-xs text-muted-foreground mt-2">Formula: {feeQuery.data.formula}</p>
              <p className="text-xs text-muted-foreground">Per architecture doc Appendix A.1: CorridorFee = PrincipalAmount × CorridorRate(dest, rail) + FixedFee</p>
            </div>
          ) : (
            <p className="text-muted-foreground">Enter amount to calculate</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// ANALYTICS (Admin Only) — Anomaly Detection, Capacity Planning, SLA, Sanctions
// =============================================================================

function AnalyticsSection() {
  const [analyticsTab, setAnalyticsTab] = useState<'anomalies' | 'capacity' | 'sla' | 'sanctions' | 'audit' | 'approvals' | 'batches' | 'netting' | 'fxlocks' | 'webhooks' | 'apiUsage' | 'ipAllowlist' | 'sandbox'>('anomalies');

  const anomaliesQuery = trpc.outboundRemittance.getAnomalyAlerts.useQuery();
  const capacityQuery = trpc.outboundRemittance.getCapacityForecasts.useQuery();
  const slaQuery = trpc.outboundRemittance.getSLABreaches.useQuery();
  const sanctionsQuery = trpc.outboundRemittance.getSanctionsUpdates.useQuery();
  const auditQuery = trpc.outboundRemittance.getAuditTrail.useQuery();
  const approvalsQuery = trpc.outboundRemittance.getPendingApprovals.useQuery();
  const batchesQuery = trpc.outboundRemittance.getBatches.useQuery();
  const nettingQuery = trpc.outboundRemittance.getNettingCycles.useQuery();
  const fxLocksQuery = trpc.outboundRemittance.getActiveFXLocks.useQuery();
  const webhooksQuery = trpc.outboundRemittance.getWebhookEvents.useQuery();
  const apiUsageQuery = trpc.outboundRemittance.getAPIUsage.useQuery();
  const ipAllowlistQuery = trpc.outboundRemittance.getIPAllowlist.useQuery();
  const sandboxQuery = trpc.outboundRemittance.getSandboxEnvironments.useQuery();

  const utils = trpc.useUtils();
  const approvalMut = trpc.outboundRemittance.submitApprovalDecision.useMutation({ onSuccess: () => utils.outboundRemittance.getPendingApprovals.invalidate() });
  const replayMut = trpc.outboundRemittance.replayWebhook.useMutation({ onSuccess: () => utils.outboundRemittance.getWebhookEvents.invalidate() });

  const anomalies = anomaliesQuery.data ?? [];
  const capacityForecasts = capacityQuery.data ?? [];
  const slaBreaches = slaQuery.data ?? [];
  const sanctionsUpdates = sanctionsQuery.data ?? [];
  const auditEntries = auditQuery.data ?? [];
  const pendingApprovals = approvalsQuery.data ?? [];
  const batches = batchesQuery.data ?? [];
  const nettingCycles = nettingQuery.data ?? [];
  const fxLocks = fxLocksQuery.data ?? [];
  const webhookEvents = webhooksQuery.data ?? [];
  const apiUsage = apiUsageQuery.data ?? [];
  const ipEntries = ipAllowlistQuery.data ?? [];
  const sandboxEnvs = sandboxQuery.data ?? [];

  const tabs = [
    { id: 'anomalies' as const, label: 'Anomalies' },
    { id: 'approvals' as const, label: `Approvals (${pendingApprovals.filter((a: any) => a.status === 'pending').length})` },
    { id: 'audit' as const, label: 'Audit Trail' },
    { id: 'batches' as const, label: 'Batch Processing' },
    { id: 'netting' as const, label: 'Netting' },
    { id: 'fxlocks' as const, label: 'FX Rate Locks' },
    { id: 'capacity' as const, label: 'Capacity' },
    { id: 'sla' as const, label: 'SLA' },
    { id: 'sanctions' as const, label: 'Sanctions' },
    { id: 'webhooks' as const, label: 'Webhooks' },
    { id: 'apiUsage' as const, label: 'API Usage' },
    { id: 'ipAllowlist' as const, label: 'IP Allowlist' },
    { id: 'sandbox' as const, label: 'Sandbox' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Platform Analytics & Operations</h1>
        <p className="text-muted-foreground">Full operational visibility — anomalies, approvals, audit, batches, netting, FX locks, SLA, sanctions, webhooks, API usage, security</p>
      </div>

      <div className="flex flex-wrap gap-2 border-b pb-2">
        {tabs.map(tab => (
          <Button key={tab.id} variant={analyticsTab === tab.id ? 'default' : 'outline'} size="sm" onClick={() => setAnalyticsTab(tab.id)}>
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Anomaly Detection */}
      {analyticsTab === 'anomalies' && (
        <Card>
          <CardHeader><CardTitle>Detected Anomalies ({anomalies.length})</CardTitle><CardDescription>ML-based pattern analysis flagging unusual transfer behavior</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>ID</TableHead><TableHead>Severity</TableHead><TableHead>Type</TableHead>
                <TableHead>Corridor</TableHead><TableHead>Description</TableHead><TableHead>Detected</TableHead><TableHead>Status</TableHead><TableHead>Affected Txns</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {anomalies.map((a: any) => (
                  <TableRow key={a.alertId}>
                    <TableCell className="font-mono text-xs">{a.alertId}</TableCell>
                    <TableCell><Badge variant={a.severity === 'critical' ? 'destructive' : a.severity === 'high' ? 'destructive' : 'secondary'}>{a.severity}</Badge></TableCell>
                    <TableCell><Badge variant="outline">{a.type?.replace(/_/g, ' ')}</Badge></TableCell>
                    <TableCell className="font-medium">{a.corridor}</TableCell>
                    <TableCell className="text-xs max-w-[300px]">{a.description}</TableCell>
                    <TableCell className="text-xs">{new Date(a.detectedAt).toLocaleTimeString()}</TableCell>
                    <TableCell><Badge variant={a.status === 'escalated' ? 'destructive' : 'outline'}>{a.status}</Badge></TableCell>
                    <TableCell className="font-bold">{a.affectedTransfers}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Dual-Approval Workflow */}
      {analyticsTab === 'approvals' && (
        <Card>
          <CardHeader><CardTitle>Pending Approvals ({pendingApprovals.filter((a: any) => a.status === 'pending').length})</CardTitle><CardDescription>Dual-approval workflow — high-value transfers, tier upgrades, compliance escalations</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>ID</TableHead><TableHead>Type</TableHead><TableHead>Subject</TableHead>
                <TableHead>Requested By</TableHead><TableHead>Approvals</TableHead><TableHead>Status</TableHead><TableHead>Expires</TableHead><TableHead>Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {pendingApprovals.map((a: any) => (
                  <TableRow key={a.requestId}>
                    <TableCell className="font-mono text-xs">{a.requestId}</TableCell>
                    <TableCell><Badge variant="outline">{a.type?.replace(/_/g, ' ')}</Badge></TableCell>
                    <TableCell className="text-xs max-w-[250px]">{a.subject}</TableCell>
                    <TableCell className="text-xs">{a.requestedBy}</TableCell>
                    <TableCell className="font-bold">{a.currentApprovals}/{a.requiredApprovals}</TableCell>
                    <TableCell><Badge variant={a.status === 'approved' ? 'default' : a.status === 'rejected' ? 'destructive' : 'secondary'}>{a.status}</Badge></TableCell>
                    <TableCell className="text-xs">{new Date(a.expiresAt).toLocaleString()}</TableCell>
                    <TableCell>
                      {a.status === 'pending' && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="default" onClick={() => approvalMut.mutate({ requestId: a.requestId, approved: true, comment: 'Approved' })} disabled={approvalMut.isPending}>Approve</Button>
                          <Button size="sm" variant="destructive" onClick={() => approvalMut.mutate({ requestId: a.requestId, approved: false, comment: 'Rejected' })} disabled={approvalMut.isPending}>Reject</Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Immutable Audit Trail */}
      {analyticsTab === 'audit' && (
        <Card>
          <CardHeader><CardTitle>Immutable Audit Trail ({auditEntries.length} entries)</CardTitle><CardDescription>Cryptographically chained, append-only event log — every state change recorded</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>#</TableHead><TableHead>Timestamp</TableHead><TableHead>Action</TableHead>
                <TableHead>Actor</TableHead><TableHead>Role</TableHead><TableHead>Resource</TableHead><TableHead>Details</TableHead><TableHead>Hash</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {auditEntries.map((e: any) => (
                  <TableRow key={e.sequence}>
                    <TableCell className="font-mono text-xs">{e.sequence}</TableCell>
                    <TableCell className="text-xs">{new Date(e.timestamp).toLocaleTimeString()}</TableCell>
                    <TableCell><Badge variant="outline">{e.action}</Badge></TableCell>
                    <TableCell className="text-xs">{e.actorId}</TableCell>
                    <TableCell><Badge variant={e.actorRole === 'admin' ? 'default' : 'secondary'}>{e.actorRole}</Badge></TableCell>
                    <TableCell className="text-xs">{e.resourceType}/{e.resourceId}</TableCell>
                    <TableCell className="text-xs max-w-[200px]">{JSON.stringify(e.details)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{e.entryHash?.slice(0, 8)}…</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Batch Processing */}
      {analyticsTab === 'batches' && (
        <Card>
          <CardHeader><CardTitle>Batch Transfers ({batches.length} batches)</CardTitle><CardDescription>Bulk transfer processing — CSV/API upload up to 5,000 transfers per batch</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Batch ID</TableHead><TableHead>Participant</TableHead><TableHead>Submitted</TableHead>
                <TableHead>Total Items</TableHead><TableHead>Success</TableHead><TableHead>Failed</TableHead><TableHead>Amount (NGN)</TableHead><TableHead>Fees (USD)</TableHead><TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {batches.map((b: any) => (
                  <TableRow key={b.batchId}>
                    <TableCell className="font-mono text-xs">{b.batchId}</TableCell>
                    <TableCell className="text-xs">{b.participantId}</TableCell>
                    <TableCell className="text-xs">{new Date(b.submittedAt).toLocaleString()}</TableCell>
                    <TableCell className="font-bold">{b.totalItems}</TableCell>
                    <TableCell className="text-green-600">{b.successCount}</TableCell>
                    <TableCell className={b.failedCount > 0 ? 'text-red-500' : ''}>{b.failedCount}</TableCell>
                    <TableCell>₦{(b.totalAmountNGN || 0).toLocaleString()}</TableCell>
                    <TableCell>${(b.totalFeesUSD || 0).toFixed(2)}</TableCell>
                    <TableCell><Badge variant={b.status === 'completed' ? 'default' : b.status === 'processing' ? 'secondary' : 'destructive'}>{b.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Multi-Currency Netting */}
      {analyticsTab === 'netting' && (
        <Card>
          <CardHeader><CardTitle>Multi-Currency Netting ({nettingCycles.length} cycles)</CardTitle><CardDescription>Bilateral netting of offsetting flows — reduces FX exposure and settlement costs</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Cycle ID</TableHead><TableHead>Period</TableHead>
                <TableHead>Gross Total</TableHead><TableHead>Net Total</TableHead><TableHead>Savings</TableHead><TableHead>Savings %</TableHead><TableHead>Pairs Netted</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {nettingCycles.map((c: any) => (
                  <TableRow key={c.cycleId}>
                    <TableCell className="font-mono text-xs">{c.cycleId}</TableCell>
                    <TableCell className="text-xs">{new Date(c.cycleStart).toLocaleDateString()} — {new Date(c.cycleEnd).toLocaleDateString()}</TableCell>
                    <TableCell>${(c.grossTotalUSD || 0).toLocaleString()}</TableCell>
                    <TableCell>${(c.netTotalUSD || 0).toLocaleString()}</TableCell>
                    <TableCell className="text-green-600 font-bold">${(c.savingsUSD || 0).toLocaleString()}</TableCell>
                    <TableCell className="text-green-600 font-bold">{c.savingsPercent}%</TableCell>
                    <TableCell>{c.pairsNetted}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* FX Rate Locks */}
      {analyticsTab === 'fxlocks' && (
        <Card>
          <CardHeader><CardTitle>FX Rate Locks ({fxLocks.length})</CardTitle><CardDescription>Lock quoted FX rates for 30-300s — prevents rate disputes, gives participants time to confirm</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Lock ID</TableHead><TableHead>Participant</TableHead><TableHead>Corridor</TableHead>
                <TableHead>Market Rate</TableHead><TableHead>Locked Rate</TableHead><TableHead>Spread (bps)</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Expires</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {fxLocks.map((l: any) => (
                  <TableRow key={l.lockId}>
                    <TableCell className="font-mono text-xs">{l.lockId}</TableCell>
                    <TableCell className="text-xs">{l.participantId}</TableCell>
                    <TableCell className="font-medium">{l.corridorId}</TableCell>
                    <TableCell>{l.marketRate?.toLocaleString()}</TableCell>
                    <TableCell className="font-bold">{l.lockedRate?.toLocaleString()}</TableCell>
                    <TableCell>{l.spread}</TableCell>
                    <TableCell>₦{(l.amountFrom || 0).toLocaleString()}</TableCell>
                    <TableCell><Badge variant={l.status === 'active' ? 'default' : l.status === 'used' ? 'secondary' : 'destructive'}>{l.status}</Badge></TableCell>
                    <TableCell className="text-xs">{new Date(l.expiresAt).toLocaleTimeString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Capacity Planning */}
      {analyticsTab === 'capacity' && (
        <Card>
          <CardHeader><CardTitle>Capacity Forecasts ({capacityForecasts.length} corridors)</CardTitle><CardDescription>ML-predicted volume + liquidity gap analysis per corridor</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Corridor</TableHead><TableHead>Date</TableHead><TableHead>Forecast Volume</TableHead>
                <TableHead>Current Liquidity</TableHead><TableHead>Gap</TableHead><TableHead>Risk</TableHead><TableHead>Notes</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {capacityForecasts.map((f: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{f.corridor}</TableCell>
                    <TableCell className="text-xs">{f.date}</TableCell>
                    <TableCell className="font-bold">${(f.forecastVolumeUSD || 0).toLocaleString()}</TableCell>
                    <TableCell>${(f.currentLiquidityUSD || 0).toLocaleString()}</TableCell>
                    <TableCell className={f.liquidityGap > 0 ? 'text-red-500 font-medium' : 'text-green-600'}>${(f.liquidityGap || 0).toLocaleString()}</TableCell>
                    <TableCell><Badge variant={f.riskLevel === 'high' ? 'destructive' : f.riskLevel === 'medium' ? 'secondary' : 'outline'}>{f.riskLevel}</Badge></TableCell>
                    <TableCell className="text-xs max-w-[200px]">{f.notes}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* SLA Monitoring */}
      {analyticsTab === 'sla' && (
        <Card>
          <CardHeader><CardTitle>SLA Breach Monitor ({slaBreaches.length} breaches)</CardTitle><CardDescription>Auto-escalation to backup provider on consecutive SLA breaches</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Corridor</TableHead><TableHead>Rail</TableHead><TableHead>SLA Target (ms)</TableHead>
                <TableHead>Actual (ms)</TableHead><TableHead>Transfer</TableHead><TableHead>Auto-Escalated</TableHead><TableHead>Fallback Used</TableHead><TableHead>Resolved</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {slaBreaches.map((b: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{b.corridor}</TableCell>
                    <TableCell><Badge variant="outline">{b.rail}</Badge></TableCell>
                    <TableCell>{b.slaTargetMs}ms</TableCell>
                    <TableCell className="text-red-500 font-bold">{b.actualMs}ms</TableCell>
                    <TableCell className="font-mono text-xs">{b.transferRef}</TableCell>
                    <TableCell>{b.autoEscalated ? '✓' : '—'}</TableCell>
                    <TableCell>{b.fallbackUsed || '—'}</TableCell>
                    <TableCell><Badge variant={b.resolved ? 'default' : 'destructive'}>{b.resolved ? 'Resolved' : 'Active'}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Sanctions Updates */}
      {analyticsTab === 'sanctions' && (
        <Card>
          <CardHeader><CardTitle>Sanctions List Monitoring ({sanctionsUpdates.length} lists)</CardTitle><CardDescription>Continuous re-screening when lists update — automated SAR filing to NFIU</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>List</TableHead><TableHead>Last Updated</TableHead><TableHead>Total Entries</TableHead>
                <TableHead>New</TableHead><TableHead>Removed</TableHead><TableHead>Re-screen Status</TableHead><TableHead>New Matches</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {sanctionsUpdates.map((s: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{s.name || s.listId}</TableCell>
                    <TableCell className="text-xs">{new Date(s.lastUpdated).toLocaleString()}</TableCell>
                    <TableCell>{(s.totalEntries || 0).toLocaleString()}</TableCell>
                    <TableCell className={s.newEntries > 0 ? 'text-yellow-500 font-medium' : ''}>{s.newEntries}</TableCell>
                    <TableCell>{s.removedEntries}</TableCell>
                    <TableCell><Badge variant={s.rescreenStatus === 'in_progress' ? 'secondary' : 'outline'}>{s.rescreenStatus}</Badge></TableCell>
                    <TableCell className={s.rescreenMatches > 0 ? 'text-red-500 font-bold' : ''}>{s.rescreenMatches}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Webhook Events */}
      {analyticsTab === 'webhooks' && (
        <Card>
          <CardHeader><CardTitle>Webhook Event Catalog ({webhookEvents.length} events)</CardTitle><CardDescription>Full event history with replay capability for failed deliveries</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Event ID</TableHead><TableHead>Type</TableHead><TableHead>Participant</TableHead>
                <TableHead>Delivered</TableHead><TableHead>HTTP Status</TableHead><TableHead>Retries</TableHead><TableHead>Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {webhookEvents.map((e: any) => (
                  <TableRow key={e.eventId}>
                    <TableCell className="font-mono text-xs">{e.eventId}</TableCell>
                    <TableCell><Badge variant="outline">{e.type}</Badge></TableCell>
                    <TableCell className="text-xs">{e.participantId}</TableCell>
                    <TableCell className="text-xs">{new Date(e.deliveredAt).toLocaleString()}</TableCell>
                    <TableCell><Badge variant={e.httpStatus === 200 ? 'default' : 'destructive'}>{e.httpStatus}</Badge></TableCell>
                    <TableCell className={e.retryCount > 0 ? 'text-yellow-500' : ''}>{e.retryCount}</TableCell>
                    <TableCell>
                      {e.httpStatus !== 200 && <Button size="sm" variant="outline" onClick={() => replayMut.mutate({ eventId: e.eventId })} disabled={replayMut.isPending}>Replay</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* API Usage */}
      {analyticsTab === 'apiUsage' && (
        <Card>
          <CardHeader><CardTitle>API Usage Dashboard ({apiUsage.length} keys)</CardTitle><CardDescription>Per-participant rate limits and usage tracking — tiered quotas (Starter/Growth/Enterprise/Premium)</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Participant</TableHead><TableHead>Key ID</TableHead><TableHead>Tier</TableHead>
                <TableHead>Total Requests</TableHead><TableHead>Today</TableHead><TableHead>Daily Limit</TableHead><TableHead>Usage %</TableHead><TableHead>Rate/min</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {apiUsage.map((u: any) => (
                  <TableRow key={u.keyId}>
                    <TableCell className="text-xs">{u.participantId}</TableCell>
                    <TableCell className="font-mono text-xs">{u.keyId}</TableCell>
                    <TableCell><Badge variant={u.tier === 'premium' ? 'default' : u.tier === 'enterprise' ? 'default' : 'outline'}>{u.tier}</Badge></TableCell>
                    <TableCell>{(u.totalRequests || 0).toLocaleString()}</TableCell>
                    <TableCell>{(u.requestsToday || 0).toLocaleString()}</TableCell>
                    <TableCell>{(u.dailyLimit || 0).toLocaleString()}</TableCell>
                    <TableCell className={u.dailyUsagePercent > 80 ? 'text-red-500 font-bold' : u.dailyUsagePercent > 50 ? 'text-yellow-500' : ''}>{u.dailyUsagePercent?.toFixed(1)}%</TableCell>
                    <TableCell>{u.ratePerMin}/min</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* IP Allowlist */}
      {analyticsTab === 'ipAllowlist' && (
        <Card>
          <CardHeader><CardTitle>IP Allowlist ({ipEntries.length} entries)</CardTitle><CardDescription>Per-participant IP/CIDR restrictions — prevents unauthorized API access</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>ID</TableHead><TableHead>Participant</TableHead><TableHead>CIDR</TableHead>
                <TableHead>Label</TableHead><TableHead>Added By</TableHead><TableHead>Hit Count</TableHead><TableHead>Enforced</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {ipEntries.map((e: any) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-xs">{e.id}</TableCell>
                    <TableCell className="text-xs">{e.participantId}</TableCell>
                    <TableCell className="font-mono">{e.cidr}</TableCell>
                    <TableCell>{e.label}</TableCell>
                    <TableCell className="text-xs">{e.addedBy}</TableCell>
                    <TableCell className="font-bold">{(e.hitCount || 0).toLocaleString()}</TableCell>
                    <TableCell><Badge variant={e.enforced ? 'default' : 'outline'}>{e.enforced ? 'Yes' : 'No'}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Sandbox Environments */}
      {analyticsTab === 'sandbox' && (
        <Card>
          <CardHeader><CardTitle>Sandbox Environments ({sandboxEnvs.length})</CardTitle><CardDescription>Participant sandbox with simulated providers — test integration without real money</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Env ID</TableHead><TableHead>Participant</TableHead><TableHead>Status</TableHead>
                <TableHead>Corridors</TableHead><TableHead>Transfers Processed</TableHead><TableHead>Last Activity</TableHead><TableHead>API Endpoint</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {sandboxEnvs.map((s: any) => (
                  <TableRow key={s.envId}>
                    <TableCell className="font-mono text-xs">{s.envId}</TableCell>
                    <TableCell className="text-xs">{s.participantId}</TableCell>
                    <TableCell><Badge variant={s.status === 'active' ? 'default' : 'secondary'}>{s.status}</Badge></TableCell>
                    <TableCell className="text-xs">{s.corridors?.join(', ')}</TableCell>
                    <TableCell className="font-bold">{s.transfersProcessed}</TableCell>
                    <TableCell className="text-xs">{new Date(s.lastActivity).toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-xs">{s.apiEndpoint}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// =============================================================================
// DEVELOPER PORTAL — API Keys, SDKs, Integration Guide, Webhooks
// =============================================================================

function DeveloperPortalSection({ role }: { role: UserRole }) {
  const [devTab, setDevTab] = useState<'apiKeys' | 'sdks' | 'guide' | 'webhookSubs'>('apiKeys');
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [keyLabel, setKeyLabel] = useState('');
  const [showWebhookForm, setShowWebhookForm] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookEvents, setWebhookEvents] = useState('transfer.completed,transfer.failed');

  const apiKeysQuery = trpc.outboundRemittance.getAPIKeys.useQuery();
  const sdksQuery = trpc.outboundRemittance.getSDKInfo.useQuery();
  const guideQuery = trpc.outboundRemittance.getIntegrationGuide.useQuery();
  const webhookSubsQuery = trpc.outboundRemittance.getWebhookSubscriptions.useQuery();

  const utils = trpc.useUtils();
  const generateKeyMut = trpc.outboundRemittance.generateAPIKey.useMutation({
    onSuccess: () => { utils.outboundRemittance.getAPIKeys.invalidate(); setShowKeyForm(false); setKeyLabel(''); },
  });
  const revokeKeyMut = trpc.outboundRemittance.revokeAPIKey.useMutation({
    onSuccess: () => { utils.outboundRemittance.getAPIKeys.invalidate(); },
  });
  const createWebhookMut = trpc.outboundRemittance.createWebhookSubscription.useMutation({
    onSuccess: () => { utils.outboundRemittance.getWebhookSubscriptions.invalidate(); setShowWebhookForm(false); setWebhookUrl(''); },
  });

  const tabs = [
    { id: 'apiKeys' as const, label: `API Keys (${apiKeysQuery.data?.length ?? 0})` },
    { id: 'sdks' as const, label: 'SDKs' },
    { id: 'guide' as const, label: 'Integration Guide' },
    { id: 'webhookSubs' as const, label: `Webhooks (${webhookSubsQuery.data?.length ?? 0})` },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Developer Portal</h1>
        <p className="text-muted-foreground">API keys, SDKs, integration guide, and webhook management</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map(tab => (
          <Button key={tab.id} variant={devTab === tab.id ? 'default' : 'outline'} size="sm" onClick={() => setDevTab(tab.id)}>
            {tab.label}
          </Button>
        ))}
      </div>

      {devTab === 'apiKeys' && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2"><Key className="h-5 w-5" /> API Keys</CardTitle>
                <CardDescription>Manage API keys for programmatic access to the remittance platform</CardDescription>
              </div>
              <Button size="sm" onClick={() => setShowKeyForm(!showKeyForm)}><Plus className="h-4 w-4 mr-1" /> Generate Key</Button>
            </div>
          </CardHeader>
          <CardContent>
            {showKeyForm && (
              <div className="mb-4 p-4 border rounded-lg bg-muted/50 space-y-3">
                <div>
                  <Label>Key Label</Label>
                  <Input value={keyLabel} onChange={e => setKeyLabel(e.target.value)} placeholder="e.g. Production API Key" />
                </div>
                <Button size="sm" onClick={() => generateKeyMut.mutate({ label: keyLabel })} disabled={!keyLabel || generateKeyMut.isPending}>
                  {generateKeyMut.isPending ? 'Generating...' : 'Generate'}
                </Button>
                {generateKeyMut.data && (
                  <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm">
                    <p className="font-bold text-yellow-800">Save this secret — it won't be shown again!</p>
                    <code className="block mt-1 text-xs break-all">{(generateKeyMut.data as any).secret}</code>
                  </div>
                )}
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key ID</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Scopes</TableHead>
                  <TableHead>Requests</TableHead>
                  <TableHead>Rate Limit</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(apiKeysQuery.data ?? []).map((k: any) => (
                  <TableRow key={k.keyId}>
                    <TableCell className="font-mono text-xs">{k.keyId}</TableCell>
                    <TableCell>{k.label}</TableCell>
                    <TableCell><StatusBadge status={k.tier} /></TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate">{k.scopes?.join(', ')}</TableCell>
                    <TableCell>{k.requestCount?.toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{k.rateLimit?.perMinute}/min, {k.rateLimit?.perDay?.toLocaleString()}/day</TableCell>
                    <TableCell><StatusBadge status={k.status} /></TableCell>
                    <TableCell className="text-xs">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Never'}</TableCell>
                    <TableCell>
                      {k.status === 'active' && (
                        <Button size="sm" variant="destructive" onClick={() => revokeKeyMut.mutate({ keyId: k.keyId })}>Revoke</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {devTab === 'sdks' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Code className="h-5 w-5" /> SDK Libraries</CardTitle>
            <CardDescription>Official client libraries for integrating with the Remittance Switch API</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(sdksQuery.data ?? []).map((sdk: any) => (
                <div key={sdk.language} className="border rounded-lg p-4 space-y-2">
                  <h3 className="font-semibold">{sdk.language}</h3>
                  <p className="text-xs text-muted-foreground">{sdk.package} v{sdk.version}</p>
                  <div className="flex items-center gap-2 bg-muted p-2 rounded text-xs font-mono">
                    <code className="flex-1">{sdk.install}</code>
                    <Copy className="h-3 w-3 cursor-pointer text-muted-foreground" />
                  </div>
                  <div className="text-xs space-y-1">
                    {sdk.features?.map((f: string, i: number) => (
                      <div key={i} className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-green-500" />{f}</div>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" className="w-full text-xs mt-2" onClick={() => window.open(sdk.docs, '_blank')}>
                    <FileText className="h-3 w-3 mr-1" /> Documentation
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {devTab === 'guide' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Integration Guide</CardTitle>
            <CardDescription>Step-by-step guide from application to production go-live</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {(guideQuery.data ?? []).map((step: any) => (
                <div key={step.step} className="flex gap-4 items-start">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm">
                    {step.step}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold">{step.title}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{step.description}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {step.estimatedTime}</span>
                      <Badge variant="outline" className="text-xs">{step.status}</Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {devTab === 'webhookSubs' && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2"><Send className="h-5 w-5" /> Webhook Subscriptions</CardTitle>
                <CardDescription>Configure webhook endpoints to receive real-time event notifications</CardDescription>
              </div>
              <Button size="sm" onClick={() => setShowWebhookForm(!showWebhookForm)}><Plus className="h-4 w-4 mr-1" /> Add Webhook</Button>
            </div>
          </CardHeader>
          <CardContent>
            {showWebhookForm && (
              <div className="mb-4 p-4 border rounded-lg bg-muted/50 space-y-3">
                <div>
                  <Label>Webhook URL</Label>
                  <Input value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} placeholder="https://api.yoursite.com/webhooks" />
                </div>
                <div>
                  <Label>Events (comma-separated)</Label>
                  <Input value={webhookEvents} onChange={e => setWebhookEvents(e.target.value)} placeholder="transfer.completed,transfer.failed" />
                </div>
                <Button size="sm" onClick={() => createWebhookMut.mutate({ url: webhookUrl, events: webhookEvents.split(',').map(e => e.trim()) })}
                  disabled={!webhookUrl || createWebhookMut.isPending}>
                  {createWebhookMut.isPending ? 'Creating...' : 'Create Subscription'}
                </Button>
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subscription ID</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead>Success</TableHead>
                  <TableHead>Failed</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Delivery</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(webhookSubsQuery.data ?? []).map((w: any) => (
                  <TableRow key={w.subscriptionId}>
                    <TableCell className="font-mono text-xs">{w.subscriptionId}</TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate">{w.url}</TableCell>
                    <TableCell className="text-xs">{w.events?.join(', ')}</TableCell>
                    <TableCell className="text-green-600">{w.successCount?.toLocaleString()}</TableCell>
                    <TableCell className="text-red-600">{w.failureCount}</TableCell>
                    <TableCell><StatusBadge status={w.status} /></TableCell>
                    <TableCell className="text-xs">{w.lastDelivery ? new Date(w.lastDelivery).toLocaleString() : 'None'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// =============================================================================
// TRANSACTION MONITORING — Live tracker, search, detail view
// =============================================================================

function TransactionMonitoringSection({ role }: { role: UserRole }) {
  const [monitorTab, setMonitorTab] = useState<'live' | 'search' | 'stuck'>('live');
  const [txSearchQuery, setTxSearchQuery] = useState('');
  const [searchCorridor, setSearchCorridor] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [selectedTransfer, setSelectedTransfer] = useState<string | null>(null);

  const isAdmin = role === 'admin' || role === 'cbn';
  const liveQuery = trpc.outboundRemittance.getLiveTransfers.useQuery();
  const statsQuery = trpc.outboundRemittance.getTransferStats.useQuery();
  const searchResults = trpc.outboundRemittance.searchTransfers.useQuery({
    query: txSearchQuery || undefined,
    corridor: searchCorridor || undefined,
    status: searchStatus || undefined,
  }, { enabled: monitorTab === 'search' });
  const stuckQuery = trpc.outboundRemittance.getStuckTransfers.useQuery(undefined, { enabled: isAdmin && monitorTab === 'stuck' });
  const lifecycleQuery = trpc.outboundRemittance.getTransferLifecycle.useQuery(
    { transferRef: selectedTransfer! },
    { enabled: !!selectedTransfer }
  );

  const stageOrder = ['admitted', 'screened', 'priced', 'debited', 'routed', 'switched', 'settled', 'confirmed'];

  const tabs = [
    { id: 'live' as const, label: `Live Transfers (${liveQuery.data?.length ?? 0})` },
    { id: 'search' as const, label: 'Search' },
    ...(isAdmin ? [{ id: 'stuck' as const, label: `Stuck (${stuckQuery.data?.length ?? 0})` }] : []),
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Transaction Monitoring</h1>
        <p className="text-muted-foreground">Real-time transfer lifecycle tracking, search, and alerting</p>
      </div>

      {statsQuery.data && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Total</p><p className="text-xl font-bold">{statsQuery.data.total}</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Completed</p><p className="text-xl font-bold text-green-600">{statsQuery.data.completed}</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">In-Flight</p><p className="text-xl font-bold text-blue-600">{statsQuery.data.inFlight}</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Failed</p><p className="text-xl font-bold text-red-600">{statsQuery.data.failed}</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Stuck</p><p className="text-xl font-bold text-orange-600">{statsQuery.data.stuck}</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Avg Latency</p><p className="text-xl font-bold">{statsQuery.data.avgLatencyMs}ms</p></CardContent></Card>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {tabs.map(tab => (
          <Button key={tab.id} variant={monitorTab === tab.id ? 'default' : 'outline'} size="sm" onClick={() => setMonitorTab(tab.id as any)}>
            {tab.label}
          </Button>
        ))}
      </div>

      {selectedTransfer && lifecycleQuery.data && (
        <Card className="border-2 border-blue-300">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5" /> Transfer Lifecycle: {lifecycleQuery.data.transferRef}
              </CardTitle>
              <Button size="sm" variant="outline" onClick={() => setSelectedTransfer(null)}>Close</Button>
            </div>
            <CardDescription>
              {lifecycleQuery.data.beneficiaryName} • {lifecycleQuery.data.corridor} via {lifecycleQuery.data.rail} • {formatNgn(lifecycleQuery.data.amountNGN)} → {lifecycleQuery.data.destCurrency} {lifecycleQuery.data.amountDest?.toLocaleString()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-1 mb-4">
              {stageOrder.map((stage) => {
                const reached = (lifecycleQuery.data as any).stages?.some((s: any) => s.stage === stage);
                const isCurrent = (lifecycleQuery.data as any).currentStatus === stage;
                return (
                  <div key={stage} className="flex items-center gap-1 flex-1">
                    <div className={`h-2 flex-1 rounded ${reached ? (isCurrent ? 'bg-blue-500 animate-pulse' : 'bg-green-500') : 'bg-gray-200'}`} />
                    <span className={`text-[10px] ${reached ? 'text-foreground' : 'text-muted-foreground'}`}>{stage.slice(0, 4)}</span>
                  </div>
                );
              })}
            </div>
            <div className="space-y-2">
              {(lifecycleQuery.data as any).stages?.map((s: any, i: number) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs">{i + 1}</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{s.stage}</span>
                      <span className="text-xs text-muted-foreground">{new Date(s.timestamp).toLocaleTimeString()}</span>
                      {s.latencyMs > 0 && <Badge variant="outline" className="text-xs">{s.latencyMs}ms</Badge>}
                    </div>
                    {s.detail && <p className="text-xs text-muted-foreground mt-0.5">{s.detail}</p>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {monitorTab === 'live' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" /> Live Transfer Pipeline</CardTitle>
            <CardDescription>All in-flight and recent transfers with real-time status</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ref</TableHead>
                  <TableHead>Beneficiary</TableHead>
                  <TableHead>Corridor</TableHead>
                  <TableHead>Rail</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Latency</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(liveQuery.data ?? []).map((t: any) => (
                  <TableRow key={t.transferRef} className={t.isStuck ? 'bg-red-50' : ''}>
                    <TableCell className="font-mono text-xs">{t.transferRef}</TableCell>
                    <TableCell>{t.beneficiaryName}</TableCell>
                    <TableCell><Badge variant="outline">{t.corridor}</Badge></TableCell>
                    <TableCell className="text-xs">{t.rail}</TableCell>
                    <TableCell>{formatNgn(t.amountNGN)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {stageOrder.map(s => {
                          const reached = t.stages?.some((st: any) => st.stage === s);
                          return <div key={s} className={`h-1.5 w-3 rounded ${reached ? 'bg-green-500' : 'bg-gray-200'}`} />;
                        })}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={t.currentStatus} />
                      {t.isStuck && <Badge variant="destructive" className="ml-1 text-xs">STUCK</Badge>}
                    </TableCell>
                    <TableCell className="text-xs">{t.totalLatencyMs ? `${t.totalLatencyMs}ms` : '—'}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => setSelectedTransfer(t.transferRef)}>
                        <Eye className="h-3 w-3 mr-1" /> Detail
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {monitorTab === 'search' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Search className="h-5 w-5" /> Transfer Search</CardTitle>
            <CardDescription>Search transfers by reference, beneficiary, corridor, or status</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <div>
                <Label>Search</Label>
                <Input value={txSearchQuery} onChange={e => setTxSearchQuery(e.target.value)} placeholder="Reference or beneficiary..." />
              </div>
              <div>
                <Label>Corridor</Label>
                <Input value={searchCorridor} onChange={e => setSearchCorridor(e.target.value)} placeholder="e.g. NG-GH" />
              </div>
              <div>
                <Label>Status</Label>
                <Input value={searchStatus} onChange={e => setSearchStatus(e.target.value)} placeholder="e.g. confirmed, failed" />
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ref</TableHead>
                  <TableHead>Beneficiary</TableHead>
                  <TableHead>Corridor</TableHead>
                  <TableHead>Rail</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(searchResults.data ?? []).map((t: any) => (
                  <TableRow key={t.transferRef}>
                    <TableCell className="font-mono text-xs">{t.transferRef}</TableCell>
                    <TableCell>{t.beneficiaryName}</TableCell>
                    <TableCell><Badge variant="outline">{t.corridor}</Badge></TableCell>
                    <TableCell className="text-xs">{t.rail}</TableCell>
                    <TableCell>{formatNgn(t.amountNGN)}</TableCell>
                    <TableCell><StatusBadge status={t.currentStatus} /></TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => setSelectedTransfer(t.transferRef)}>
                        <Eye className="h-3 w-3 mr-1" /> Detail
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {monitorTab === 'stuck' && isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-red-500" /> Stuck Transfers</CardTitle>
            <CardDescription>Transfers that have exceeded SLA or are stuck at a stage</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ref</TableHead>
                  <TableHead>Participant</TableHead>
                  <TableHead>Beneficiary</TableHead>
                  <TableHead>Corridor</TableHead>
                  <TableHead>Rail</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Current Stage</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(stuckQuery.data ?? []).map((t: any) => (
                  <TableRow key={t.transferRef} className="bg-red-50">
                    <TableCell className="font-mono text-xs">{t.transferRef}</TableCell>
                    <TableCell className="text-xs">{t.participantId}</TableCell>
                    <TableCell>{t.beneficiaryName}</TableCell>
                    <TableCell><Badge variant="outline">{t.corridor}</Badge></TableCell>
                    <TableCell className="text-xs">{t.rail}</TableCell>
                    <TableCell>{formatNgn(t.amountNGN)}</TableCell>
                    <TableCell><StatusBadge status={t.currentStatus} /></TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => setSelectedTransfer(t.transferRef)}>
                        <Eye className="h-3 w-3 mr-1" /> Investigate
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// =============================================================================
// SETTLEMENT ENGINE
// =============================================================================

function SettlementSection() {
  const [stlTab, setStlTab] = useState<'batches' | 'railConfig' | 'positions'>('batches');
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);

  const statsQuery = trpc.outboundRemittance.getSettlementStats.useQuery();
  const batchesQuery = trpc.outboundRemittance.getSettlementBatches.useQuery();
  const railConfigsQuery = trpc.outboundRemittance.getSettlementRailConfigs.useQuery();
  const batchDetailQuery = trpc.outboundRemittance.getSettlementBatchDetail.useQuery(
    { batchId: selectedBatch! },
    { enabled: !!selectedBatch }
  );

  const utils = trpc.useUtils();
  const confirmMut = trpc.outboundRemittance.confirmSettlementBatch.useMutation({
    onSuccess: (d) => { utils.outboundRemittance.getSettlementBatches.invalidate(); utils.outboundRemittance.getSettlementStats.invalidate(); toast.success(`Batch ${d.batchId} confirmed`); },
    onError: (e) => toast.error(`Confirm failed: ${e.message}`),
  });
  const retryMut = trpc.outboundRemittance.retrySettlementBatch.useMutation({
    onSuccess: (d) => { utils.outboundRemittance.getSettlementBatches.invalidate(); utils.outboundRemittance.getSettlementStats.invalidate(); toast.success(`Batch ${d.batchId} retrying (attempt ${d.retryCount})`); },
    onError: (e) => toast.error(`Retry failed: ${e.message}`),
  });

  const stats = statsQuery.data;
  const batches = batchesQuery.data || [];

  const stlStatusColor = (s: string) => {
    switch (s) {
      case 'CONFIRMED': case 'RECONCILED': return 'bg-green-100 text-green-800';
      case 'SUBMITTED': return 'bg-blue-100 text-blue-800';
      case 'NETTING': return 'bg-yellow-100 text-yellow-800';
      case 'FAILED': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settlement Engine</h1>
        <p className="text-muted-foreground">Batch netting, settlement windows, reconciliation across all 9 payment rails</p>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Total Batches</p><p className="text-2xl font-bold">{stats.totalBatches}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Gross Volume</p><p className="text-2xl font-bold">{formatNgn(stats.totalGrossVolume)}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Net Volume</p><p className="text-2xl font-bold">{formatNgn(stats.totalNetVolume)}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Netting Savings</p><p className="text-2xl font-bold text-green-600">{formatNgn(stats.nettingSavings)}</p><p className="text-xs text-green-600">{stats.nettingSavingsPct}% saved</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Avg Settlement</p><p className="text-2xl font-bold">{(stats.avgSettlementTimeMs / 1000).toFixed(0)}s</p></CardContent></Card>
        </div>
      )}

      <div className="flex gap-2 border-b pb-2">
        {(['batches', 'railConfig', 'positions'] as const).map(t => (
          <Button key={t} variant={stlTab === t ? 'default' : 'ghost'} size="sm" onClick={() => setStlTab(t)}>
            {t === 'batches' ? `Batches (${batches.length})` : t === 'railConfig' ? 'Rail Config' : 'Pending Queues'}
          </Button>
        ))}
      </div>

      {stlTab === 'batches' && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div><CardTitle>Settlement Batches</CardTitle><CardDescription>Active and completed batch settlements across all rails</CardDescription></div>
              <Button variant="outline" size="sm" onClick={() => exportTableToCSV(
                ['Batch ID', 'Rail', 'Status', 'Transfers', 'Gross NGN', 'Net NGN'],
                batches.map((b: any) => [b.batchId, b.railId, b.status, b.transferCount, b.totalGrossNGN, b.totalNetNGN]),
                'settlement-batches.csv'
              )}><Download className="h-3 w-3 mr-1" />Export CSV</Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch ID</TableHead><TableHead>Rail</TableHead><TableHead>Status</TableHead>
                  <TableHead>Transfers</TableHead><TableHead>Gross</TableHead><TableHead>Net</TableHead>
                  <TableHead>Window</TableHead><TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b: any) => (
                  <TableRow key={b.batchId}>
                    <TableCell className="font-mono text-xs">{b.batchId}</TableCell>
                    <TableCell><Badge variant="outline">{b.railId}</Badge></TableCell>
                    <TableCell><Badge className={stlStatusColor(b.status)}>{b.status}</Badge></TableCell>
                    <TableCell>{b.transferCount}</TableCell>
                    <TableCell className="font-mono text-xs">{formatNgn(b.totalGrossNGN)}</TableCell>
                    <TableCell className="font-mono text-xs">{b.totalNetNGN > 0 ? formatNgn(b.totalNetNGN) : '---'}</TableCell>
                    <TableCell className="text-xs">{new Date(b.windowStart).toLocaleTimeString()} - {new Date(b.windowEnd).toLocaleTimeString()}</TableCell>
                    <TableCell className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setSelectedBatch(b.batchId)}>Detail</Button>
                      {b.status === 'SUBMITTED' && <Button size="sm" onClick={() => confirmMut.mutate({ batchId: b.batchId })} disabled={confirmMut.isPending}>Confirm</Button>}
                      {b.status === 'FAILED' && <Button size="sm" variant="destructive" onClick={() => retryMut.mutate({ batchId: b.batchId })} disabled={retryMut.isPending}>Retry</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {stlTab === 'railConfig' && (
        <Card>
          <CardHeader><CardTitle>Settlement Rail Configuration</CardTitle><CardDescription>Settlement model, windows, and file formats per payment rail</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rail</TableHead><TableHead>Model</TableHead><TableHead>Window</TableHead>
                  <TableHead>Cutoff</TableHead><TableHead>Max Batch</TableHead><TableHead>Retries</TableHead>
                  <TableHead>File Format</TableHead><TableHead>Currencies</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(railConfigsQuery.data || []).map((rc: any) => (
                  <TableRow key={rc.railId}>
                    <TableCell className="font-semibold">{rc.railName}</TableCell>
                    <TableCell><Badge variant={rc.model === 'DEFERRED_NET' ? 'default' : 'secondary'}>{rc.model === 'DEFERRED_NET' ? 'Deferred Net' : 'Immediate Gross'}</Badge></TableCell>
                    <TableCell>{rc.windowHours > 0 ? `${rc.windowHours}h` : 'Real-time'}</TableCell>
                    <TableCell className="text-xs">{rc.cutoffTime}</TableCell>
                    <TableCell>{rc.maxBatchSize.toLocaleString()}</TableCell>
                    <TableCell>{rc.retryAttempts}</TableCell>
                    <TableCell><Badge variant="outline">{rc.fileFormat}</Badge></TableCell>
                    <TableCell className="text-xs">{rc.currencies.join(', ')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {stlTab === 'positions' && stats && (
        <Card>
          <CardHeader><CardTitle>Pending Settlement Queues</CardTitle><CardDescription>Transfers awaiting next settlement window per rail</CardDescription></CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
              {Object.entries(stats.pendingTransfers).map(([rail, count]: [string, any]) => (
                <div key={rail} className="border rounded-lg p-3 text-center">
                  <p className="text-xs font-semibold text-muted-foreground">{rail}</p>
                  <p className={`text-2xl font-bold ${count > 0 ? 'text-blue-600' : 'text-gray-400'}`}>{count}</p>
                  <p className="text-xs text-muted-foreground">pending</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {selectedBatch && batchDetailQuery.data && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedBatch(null)}>
          <div className="bg-white rounded-lg shadow-lg max-w-3xl w-full max-h-[80vh] overflow-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">Batch: {batchDetailQuery.data.batchId}</h2>
              <Button variant="ghost" size="sm" onClick={() => setSelectedBatch(null)}>Close</Button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="border rounded p-2"><p className="text-xs text-muted-foreground">Rail</p><p className="font-semibold">{batchDetailQuery.data.railId}</p></div>
              <div className="border rounded p-2"><p className="text-xs text-muted-foreground">Status</p><Badge className={stlStatusColor(batchDetailQuery.data.status)}>{batchDetailQuery.data.status}</Badge></div>
              <div className="border rounded p-2"><p className="text-xs text-muted-foreground">Transfers</p><p className="font-semibold">{batchDetailQuery.data.transferCount}</p></div>
              <div className="border rounded p-2"><p className="text-xs text-muted-foreground">Retries</p><p className="font-semibold">{batchDetailQuery.data.retryCount}</p></div>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="border rounded p-2"><p className="text-xs text-muted-foreground">Gross</p><p className="font-mono text-sm">{formatNgn(batchDetailQuery.data.totalGrossNGN)}</p></div>
              <div className="border rounded p-2"><p className="text-xs text-muted-foreground">Net</p><p className="font-mono text-sm">{batchDetailQuery.data.totalNetNGN > 0 ? formatNgn(batchDetailQuery.data.totalNetNGN) : '---'}</p></div>
              <div className="border rounded p-2"><p className="text-xs text-muted-foreground">Savings</p><p className="font-mono text-sm text-green-600">{batchDetailQuery.data.totalNetNGN > 0 ? formatNgn(batchDetailQuery.data.totalGrossNGN - batchDetailQuery.data.totalNetNGN) : '---'}</p></div>
            </div>
            {batchDetailQuery.data.failReason && (
              <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
                <p className="text-sm font-semibold text-red-800">Failure Reason</p>
                <p className="text-sm text-red-700">{batchDetailQuery.data.failReason}</p>
              </div>
            )}
            <h3 className="text-sm font-semibold mb-2">Net Positions</h3>
            <Table>
              <TableHeader><TableRow><TableHead>Participant</TableHead><TableHead>Currency</TableHead><TableHead>Gross</TableHead><TableHead>Net</TableHead><TableHead>Txns</TableHead></TableRow></TableHeader>
              <TableBody>
                {batchDetailQuery.data.netPositions.map((np: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-semibold">{np.participantId}</TableCell>
                    <TableCell><Badge variant="outline">{np.currency}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{formatNgn(np.grossDebit)}</TableCell>
                    <TableCell className="font-mono text-xs">{formatNgn(np.netAmount)}</TableCell>
                    <TableCell>{np.transferCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {batchDetailQuery.data.reconciliation && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold mb-2">Reconciliation</h3>
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                  <div className="border rounded p-2 text-center"><p className="text-xs text-muted-foreground">Matched</p><p className="font-bold text-green-600">{batchDetailQuery.data.reconciliation.matched}</p></div>
                  <div className="border rounded p-2 text-center"><p className="text-xs text-muted-foreground">Unmatched</p><p className="font-bold text-red-600">{batchDetailQuery.data.reconciliation.unmatched}</p></div>
                  <div className="border rounded p-2 text-center"><p className="text-xs text-muted-foreground">Overpaid</p><p className="font-bold">{batchDetailQuery.data.reconciliation.overpaid}</p></div>
                  <div className="border rounded p-2 text-center"><p className="text-xs text-muted-foreground">Underpaid</p><p className="font-bold">{batchDetailQuery.data.reconciliation.underpaid}</p></div>
                  <div className="border rounded p-2 text-center"><p className="text-xs text-muted-foreground">Discrepancy</p><p className="font-bold">{formatNgn(Math.abs(batchDetailQuery.data.reconciliation.discrepancy))}</p></div>
                  <div className="border rounded p-2 text-center"><p className="text-xs text-muted-foreground">Status</p><Badge className={batchDetailQuery.data.reconciliation.status === 'clean' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>{batchDetailQuery.data.reconciliation.status}</Badge></div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
