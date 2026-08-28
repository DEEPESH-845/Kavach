"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Search, FileText, LayoutDashboard, Target, CreditCard, Undo2, BrainCircuit, Users, Settings, ArrowRight, CornerDownLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Reset when opened
  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50); // slight delay to allow rendering
    }
  }, [isOpen]);

  // Handle global Cmd+K shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        isOpen ? onClose() : document.dispatchEvent(new CustomEvent('open-command-palette'));
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const groups = [
    {
      name: 'Navigation',
      items: [
        { id: 'nav-home', label: 'Go to Dashboard', icon: <LayoutDashboard size={16} />, path: '/dashboard' },
        { id: 'nav-intents', label: 'Go to Intents', icon: <Target size={16} />, path: '/dashboard/intents' },
        { id: 'nav-payments', label: 'Go to Payments', icon: <CreditCard size={16} />, path: '/dashboard/payments' },
        { id: 'nav-refunds', label: 'Go to Refunds', icon: <Undo2 size={16} />, path: '/dashboard/refunds' },
        { id: 'nav-risk', label: 'Go to Risk Intelligence', icon: <BrainCircuit size={16} />, path: '/dashboard/risk' },
        { id: 'nav-agents', label: 'Go to Agents', icon: <Users size={16} />, path: '/dashboard/agents' },
        { id: 'nav-settings', label: 'Go to Settings', icon: <Settings size={16} />, path: '/dashboard/settings' },
      ]
    },
    {
      name: 'Quick Actions',
      items: [
        { id: 'action-export', label: 'Export Intent Report', icon: <FileText size={16} />, action: () => alert('Exporting report...') },
      ]
    }
  ];

  // Filter based on search
  const filteredGroups = groups.map(group => {
    const filtered = group.items.filter(item => 
      item.label.toLowerCase().includes(search.toLowerCase())
    );
    return { ...group, items: filtered };
  }).filter(group => group.items.length > 0);

  const flatItems = filteredGroups.flatMap(group => group.items);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => (prev < flatItems.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev > 0 ? prev - 1 : prev));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flatItems[activeIndex]) {
        executeItem(flatItems[activeIndex]);
      }
    }
  };

  const executeItem = (item: any) => {
    if (item.path) {
      router.push(item.path);
    } else if (item.action) {
      item.action();
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div 
      className="command-palette-overlay" 
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--overlay-bg, rgba(0, 0, 0, 0.4))',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '15vh',
        animation: 'paletteFadeIn 0.2s ease-out both'
      }}
    >
      <div 
        className="command-palette-container"
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '640px',
          backgroundColor: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '12px',
          boxShadow: '0 24px 48px -12px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '60vh',
          animation: 'paletteSlideDown 0.25s cubic-bezier(0.16, 1, 0.3, 1) both'
        }}
      >
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Search size={18} style={{ color: 'var(--text-tertiary)' }} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command or search..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setActiveIndex(0); // reset active index on search
            }}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: '15px',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-sans)',
            }}
          />
          <div style={{ display: 'flex', gap: '4px' }}>
            <kbd style={{ fontSize: '10px', background: 'var(--glass-2)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>ESC</kbd>
          </div>
        </div>

        <div style={{ overflowY: 'auto', padding: '8px' }}>
          {filteredGroups.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>
              No results found for "{search}"
            </div>
          ) : (
            filteredGroups.map((group, groupIndex) => (
              <div key={group.name} style={{ marginBottom: groupIndex < filteredGroups.length - 1 ? '16px' : '0' }}>
                <div style={{ padding: '8px 12px', fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {group.name}
                </div>
                {group.items.map((item) => {
                  const globalIndex = flatItems.findIndex(i => i.id === item.id);
                  const isSelected = globalIndex === activeIndex;
                  return (
                    <div
                      key={item.id}
                      onClick={() => executeItem(item)}
                      onMouseEnter={() => setActiveIndex(globalIndex)}
                      style={{
                        padding: '12px',
                        margin: '2px 0',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        backgroundColor: isSelected ? 'var(--accent-blue-bg)' : 'transparent',
                        color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                        transition: 'all 0.1s ease'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ color: isSelected ? 'var(--accent-blue)' : 'var(--text-tertiary)' }}>
                          {item.icon}
                        </span>
                        <span style={{ fontSize: '14px', fontWeight: isSelected ? 500 : 400 }}>{item.label}</span>
                      </div>
                      {isSelected && (
                        <CornerDownLeft size={14} style={{ color: 'var(--accent-blue)', opacity: 0.8 }} />
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
      
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes paletteFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes paletteSlideDown {
          from { opacity: 0; transform: scale(0.96) translateY(-16px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}} />
    </div>
  );
}
