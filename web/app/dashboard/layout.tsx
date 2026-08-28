'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  Target, 
  CreditCard, 
  Undo2, 
  FileText, 
  CheckSquare, 
  RefreshCcw, 
  Users, 
  ShieldCheck, 
  BrainCircuit, 
  Search, 
  Webhook, 
  BugOff, 
  LineChart, 
  Settings,
  HelpCircle,
  Bell,
  Command,
  ChevronDown
} from 'lucide-react';
import './dashboard.css';
import CommandPalette from '@/components/CommandPalette';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
    
    // Listen for custom event from CommandPalette or other components
    const handleOpenCmd = () => setCmdPaletteOpen(true);
    document.addEventListener('open-command-palette', handleOpenCmd);
    return () => document.removeEventListener('open-command-palette', handleOpenCmd);
  }, []);

  const isActive = (path: string) => pathname === path;

  return (
    <div className="dashboard-layout">
      {/* Sidebar S++ */}
      <aside className="dashboard-sidebar">
        <div className="sidebar-header">
          <div className="logo">KAVACH</div>
          <div className="environment-badge replay">REPLAY</div>
        </div>
        
        <div className="sidebar-merchant">
          <div className="merchant-name">Acme Corp</div>
          <ChevronDown size={14} className="merchant-selector" />
        </div>

        <nav className="sidebar-nav">
          <div className="nav-group">
            <div className="nav-group-label">Overview</div>
            <Link href="/dashboard" className="nav-link" data-active={isActive('/dashboard')}>
              <LayoutDashboard size={16} /> Dashboard
            </Link>
          </div>

          <div className="nav-group">
            <div className="nav-group-label">Operations</div>
            <Link href="/dashboard/intents" className="nav-link" data-active={isActive('/dashboard/intents')}>
              <Target size={16} /> Intents
            </Link>
            <Link href="/dashboard/payments" className="nav-link" data-active={isActive('/dashboard/payments')}>
              <CreditCard size={16} /> Payments
            </Link>
            <Link href="/dashboard/refunds" className="nav-link" data-active={isActive('/dashboard/refunds')}>
              <Undo2 size={16} /> Refunds
            </Link>
            <Link href="/dashboard/obligations" className="nav-link" data-active={isActive('/dashboard/obligations')}>
              <FileText size={16} /> Obligations
            </Link>
            <Link href="/dashboard/approvals" className="nav-link" data-active={isActive('/dashboard/approvals')}>
              <CheckSquare size={16} /> Approvals
            </Link>
            <Link href="/dashboard/reconciliation" className="nav-link" data-active={isActive('/dashboard/reconciliation')}>
              <RefreshCcw size={16} /> Reconciliation
            </Link>
          </div>

          <div className="nav-group">
            <div className="nav-group-label">Trust</div>
            <Link href="/dashboard/agents" className="nav-link" data-active={isActive('/dashboard/agents')}>
              <Users size={16} /> Agents
            </Link>
            <Link href="/dashboard/gate" className="nav-link" data-active={isActive('/dashboard/gate')}>
              <ShieldCheck size={16} /> Inbound Gate
            </Link>
            <Link href="/dashboard/risk" className="nav-link" data-active={isActive('/dashboard/risk')}>
              <BrainCircuit size={16} /> Risk Intelligence
            </Link>
          </div>

          <div className="nav-group">
            <div className="nav-group-label">Proof</div>
            <Link href="/dashboard/proof" className="nav-link" data-active={isActive('/dashboard/proof')}>
              <Search size={16} /> Proof Explorer
            </Link>
          </div>

          <div className="nav-group">
            <div className="nav-group-label">Developer</div>
            <Link href="/dashboard/integrations" className="nav-link" data-active={isActive('/dashboard/integrations')}>
              <Webhook size={16} /> Integrations
            </Link>
          </div>

          <div className="nav-group">
            <div className="nav-group-label">Research</div>
            <Link href="/dashboard/adversary" className="nav-link" data-active={isActive('/dashboard/adversary')}>
              <BugOff size={16} /> Adversary Lab
            </Link>
            <Link href="/dashboard/evaluations" className="nav-link" data-active={isActive('/dashboard/evaluations')}>
              <LineChart size={16} /> Evaluations
            </Link>
          </div>

          <div className="nav-group">
            <div className="nav-group-label">Settings</div>
            <Link href="/dashboard/settings" className="nav-link" data-active={isActive('/dashboard/settings')}>
              <Settings size={16} /> Merchant Settings
            </Link>
          </div>
        </nav>
      </aside>

      {/* Main Content Area */}
      <div className="dashboard-main">
        {/* Topbar S++ */}
        <header className="dashboard-topbar">
          <div className="topbar-search">
            <button aria-label="Search command palette" onClick={() => setCmdPaletteOpen(true)}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Search size={14} /> Search intent, payment...
              </span>
              <span className="search-shortcut">
                {mounted && navigator.platform.toLowerCase().includes('mac') ? '⌘K' : 'Ctrl+K'}
              </span>
            </button>
          </div>
          <div className="topbar-actions">
            <button className="icon-btn" title="Documentation">
              <HelpCircle size={18} />
            </button>
            <button className="icon-btn" title="Notifications">
              <Bell size={18} />
            </button>
            <div className="profile-avatar">OP</div>
          </div>
        </header>

        {/* Page Content */}
        <main className="dashboard-content">
          {children}
        </main>
      </div>

      <CommandPalette isOpen={cmdPaletteOpen} onClose={() => setCmdPaletteOpen(false)} />
    </div>
  );
}
