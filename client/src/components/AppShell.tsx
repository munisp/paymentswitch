import React, { useState, useEffect, useMemo } from 'react';
import { Link, useLocation } from 'wouter';
import {
  Home, LayoutDashboard, Globe, ArrowDownLeft, Banknote, Ship, CreditCard,
  Landmark, Code, Shield, BarChart3, Database, Settings, FileText, Wallet,
  Search, PanelLeftClose, PanelLeft, ChevronRight, ChevronDown, Bell,
  UserPlus, Gauge, Network, Zap, Activity, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/useMobile';

interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  section?: string;
  badge?: number;
  children?: NavItem[];
}

const NAV_ITEMS: NavItem[] = [
  // Home
  { id: 'home', label: 'Home', href: '/', icon: Home, section: 'Home' },
  { id: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },

  // Payment Modules
  { id: 'outbound', label: 'Outbound Remittance', href: '/outbound-remittance', icon: Globe, section: 'Payment Modules' },
  { id: 'inbound', label: 'Inbound Remittance', href: '/inbound-remittance', icon: ArrowDownLeft },
  { id: 'domestic', label: 'Domestic Payments', href: '/domestic-payments', icon: Banknote },
  { id: 'trade', label: 'Trade Payments', href: '/trade-payments', icon: Ship },
  { id: 'card', label: 'Card Processing', href: '/card-processing', icon: CreditCard },
  { id: 'government', label: 'Government Payments', href: '/government-payments', icon: Landmark },
  { id: 'open-banking', label: 'Open Banking', href: '/open-banking', icon: Network },

  // Operations
  { id: 'settlements', label: 'Settlements', href: '/settlements', icon: Wallet, section: 'Operations' },
  { id: 'analytics', label: 'Analytics', href: '/analytics', icon: BarChart3 },
  { id: 'sanctions', label: 'Sanctions Screening', href: '/sanctions', icon: Shield },
  { id: 'security', label: 'Security', href: '/security', icon: Shield },

  // Platform
  { id: 'middleware', label: 'Middleware', href: '/middleware', icon: Database, section: 'Platform' },
  { id: 'docs', label: 'Developer Portal', href: '/docs', icon: Code },
  { id: 'payments', label: 'Payment Gateway', href: '/payments', icon: Zap },
  { id: 'admin', label: 'Admin', href: '/admin', icon: Settings },

  // Onboarding
  { id: 'onboard-portal', label: 'Apply', href: '/onboarding/portal', icon: UserPlus, section: 'Onboarding' },
  { id: 'onboard-tech', label: 'Technical Setup', href: '/onboarding/technical', icon: Code },
  { id: 'onboard-cert', label: 'Certification', href: '/onboarding/certification', icon: FileText },
  { id: 'onboard-live', label: 'Go Live', href: '/onboarding/go-live', icon: Activity },

  // Account
  { id: 'rate-alerts', label: 'Rate Alerts', href: '/rate-alerts', icon: Bell, section: 'Account' },
  { id: 'settings-2fa', label: '2FA Settings', href: '/settings/2fa', icon: Shield },
  { id: 'settings-notif', label: 'Notifications', href: '/settings/notifications', icon: Bell },
  { id: 'settings-activity', label: 'Activity', href: '/settings/activity', icon: Activity },
];

// Routes that should NOT show the sidebar (standalone pages)
const STANDALONE_ROUTES = ['/checkout/', '/verify-2fa', '/account-recovery', '/preview/'];

function Breadcrumb({ pathname }: { pathname: string }) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return null;

  const crumbs = parts.map((part, i) => {
    const href = '/' + parts.slice(0, i + 1).join('/');
    const label = part.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return { href, label };
  });

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-muted-foreground px-6 pt-3">
      <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
      {crumbs.map((crumb, i) => (
        <React.Fragment key={crumb.href}>
          <ChevronRight className="h-3 w-3" />
          {i === crumbs.length - 1 ? (
            <span className="text-foreground font-medium">{crumb.label}</span>
          ) : (
            <Link href={crumb.href} className="hover:text-foreground transition-colors">{crumb.label}</Link>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

interface AppShellProps {
  children: React.ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const isMobile = useIsMobile();

  // Keyboard shortcut: Ctrl+B to toggle sidebar
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        setCollapsed(prev => !prev);
      }
      // Ctrl+K to focus search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const input = document.getElementById('sidebar-search');
        input?.focus();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Close mobile nav on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  // Check if current route is standalone (no sidebar)
  const isStandalone = STANDALONE_ROUTES.some(r => location.startsWith(r));
  if (isStandalone) return <>{children}</>;

  // Group nav items by section
  const sections = useMemo(() => {
    const map = new Map<string | undefined, NavItem[]>();
    const filtered = searchQuery
      ? NAV_ITEMS.filter(item => item.label.toLowerCase().includes(searchQuery.toLowerCase()))
      : NAV_ITEMS;
    filtered.forEach(item => {
      const key = item.section;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    });
    return map;
  }, [searchQuery]);

  // Pages with their own ModuleLayout sidebar shouldn't get the global sidebar
  const MODULE_ROUTES = [
    '/outbound-remittance', '/inbound-remittance', '/domestic-payments',
    '/trade-payments', '/card-processing', '/government-payments',
    '/open-banking', '/middleware',
  ];
  const hasOwnSidebar = MODULE_ROUTES.some(r => location === r);

  if (hasOwnSidebar) {
    return (
      <>
        <Breadcrumb pathname={location} />
        {children}
      </>
    );
  }

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
        <div className="h-7 w-7 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
          <Zap className="h-4 w-4 text-white" />
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold truncate">Payment Switch</div>
            <div className="text-[10px] text-muted-foreground">Nigeria National</div>
          </div>
        )}
        <button
          onClick={() => isMobile ? setMobileOpen(false) : setCollapsed(!collapsed)}
          className="p-1 rounded hover:bg-accent text-muted-foreground flex-shrink-0"
          title={collapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
        >
          {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {/* Search */}
      {!collapsed && (
        <div className="px-3 pt-3 pb-1">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              id="sidebar-search"
              type="search"
              role="searchbox"
              aria-label="Search navigation"
              placeholder="Search... (Ctrl+K)"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full rounded-md border border-border bg-background pl-8 pr-8 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav aria-label="Main navigation" role="navigation" className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {Array.from(sections.entries()).map(([section, items]) => (
          <React.Fragment key={section || 'main'}>
            {section && !collapsed && (
              <div className="px-3 pt-4 pb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {section}
                </span>
              </div>
            )}
            {section && collapsed && <div className="my-2 mx-2 border-t border-border" />}
            {items.map(item => {
              const isActive = location === item.href || (item.href !== '/' && location.startsWith(item.href));
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  aria-label={item.label}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2.5 w-full rounded-md text-left text-[13px] font-medium transition-colors',
                    collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2',
                    isActive
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-foreground/80 hover:bg-accent hover:text-foreground'
                  )}
                >
                  <item.icon className="h-4 w-4 flex-shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="truncate flex-1">{item.label}</span>
                      {item.badge !== undefined && item.badge > 0 && (
                        <span className="ml-auto rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white leading-none">
                          {item.badge}
                        </span>
                      )}
                    </>
                  )}
                </Link>
              );
            })}
          </React.Fragment>
        ))}
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div className="border-t border-border px-4 py-3 text-[10px] text-muted-foreground">
          <span>Ctrl+B toggle &middot; Ctrl+K search</span>
        </div>
      )}
    </>
  );

  return (
    <div className="flex min-h-screen bg-background font-sans">
      {/* Skip to main content link for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:bg-blue-600 focus:text-white focus:px-4 focus:py-2 focus:rounded-md focus:text-sm"
      >
        Skip to main content
      </a>
      {/* Mobile overlay */}
      {isMobile && mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar — desktop */}
      {!isMobile && (
        <aside
          role="complementary"
          aria-label="Sidebar navigation"
          className={cn(
            'flex flex-col flex-shrink-0 border-r border-border bg-muted/30 transition-all duration-200 sticky top-0 h-screen',
            collapsed ? 'w-16' : 'w-60'
          )}
        >
          {sidebarContent}
        </aside>
      )}

      {/* Sidebar — mobile drawer */}
      {isMobile && mobileOpen && (
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
          className="fixed left-0 top-0 z-50 flex flex-col w-72 h-screen border-r border-border bg-background shadow-xl"
        >
          {sidebarContent}
        </aside>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        {isMobile && (
          <header className="flex items-center gap-3 border-b border-border px-4 py-3 bg-background sticky top-0 z-30">
            <button
              onClick={() => setMobileOpen(true)}
              className="p-1 rounded hover:bg-accent"
              aria-label="Open navigation menu"
              aria-expanded={mobileOpen}
            >
              <PanelLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <span className="text-sm font-bold">Payment Switch</span>
          </header>
        )}

        <Breadcrumb pathname={location} />

        <main id="main-content" className="flex-1" role="main">
          {children}
        </main>
      </div>
    </div>
  );
}
