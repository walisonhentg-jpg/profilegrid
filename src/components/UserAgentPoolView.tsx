import { useMemo, useRef, useState } from 'react';
import {
  Check,
  Monitor,
  Plus,
  Search,
  Smartphone,
  Tablet,
  Trash2,
  Upload,
} from 'lucide-react';
import { PRESET_USER_AGENTS, SOCIAL_APP_USER_AGENTS } from '../lib/uaParser.ts';
import type { UserAgentEntry } from '../types/automation.ts';

interface UserAgentPoolViewProps {
  userAgents: UserAgentEntry[];
  onImport: (rawText: string) => Promise<{ addedCount: number }>;
  onDelete: (id: string) => Promise<void>;
  onClearAll: () => Promise<void>;
}

export function UserAgentPoolView({
  userAgents,
  onImport,
  onDelete,
  onClearAll,
}: UserAgentPoolViewProps) {
  const [pasteText, setPasteText] = useState('');
  const [importing, setImporting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [deviceFilter, setDeviceFilter] = useState<'all' | 'Desktop' | 'Mobile' | 'Tablet'>('all');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    return userAgents.filter((ua) => {
      if (deviceFilter !== 'all' && ua.deviceType !== deviceFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          ua.raw.toLowerCase().includes(q) ||
          ua.os.toLowerCase().includes(q) ||
          ua.browser.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [userAgents, deviceFilter, search]);

  async function handleImportSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pasteText.trim()) return;
    setImporting(true);
    setFeedback(null);
    try {
      const res = await onImport(pasteText);
      setFeedback(`Connected ${res.addedCount} new User-Agent string(s) into pool.`);
      setPasteText('');
    } finally {
      setImporting(false);
    }
  }

  async function handleAddPresets() {
    setImporting(true);
    setFeedback(null);
    try {
      const res = await onImport(PRESET_USER_AGENTS.join('\n'));
      setFeedback(`Added ${res.addedCount} preset User-Agent string(s).`);
    } finally {
      setImporting(false);
    }
  }

  async function handleAddSocialAppPresets() {
    setImporting(true);
    setFeedback(null);
    try {
      const res = await onImport(SOCIAL_APP_USER_AGENTS.join('\n'));
      setFeedback(`Added ${res.addedCount} Facebook, Instagram & YouTube in-app User-Agent(s).`);
    } finally {
      setImporting(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    let parsedLines = text;
    if (file.name.endsWith('.json')) {
      try {
        const json = JSON.parse(text);
        if (Array.isArray(json)) {
          parsedLines = json
            .map((item) =>
              typeof item === 'string'
                ? item
                : typeof item?.userAgent === 'string'
                  ? item.userAgent
                  : ''
            )
            .filter(Boolean)
            .join('\n');
        }
      } catch {
        // Fallback to raw lines
      }
    }
    setImporting(true);
    try {
      const res = await onImport(parsedLines);
      setFeedback(`Imported ${res.addedCount} User-Agent string(s) from ${file.name}.`);
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  }

  return (
    <div className="space-y-6">
      {/* Import Panel */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Import &amp; Connect User-Agents
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Paste unlimited User-Agent strings (one per line) or upload a .txt / .json file. Each UA is automatically parsed for OS, browser engine, and device class.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.json,.csv"
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Import File</span>
            </button>
            <button
              type="button"
              onClick={handleAddPresets}
              disabled={importing}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Load Desktop &amp; Mobile Presets</span>
            </button>
            <button
              type="button"
              onClick={handleAddSocialAppPresets}
              disabled={importing}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Load FB / IG / YT App UAs</span>
            </button>
          </div>
        </div>

        <form onSubmit={handleImportSubmit} className="space-y-3">
          <textarea
            rows={4}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36\nMozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1`}
            className="w-full p-3 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              {feedback ? (
                <span className="text-emerald-700 font-medium inline-flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5" />
                  {feedback}
                </span>
              ) : (
                <span>
                  {pasteText.split(/\r?\n/).filter((l) => l.trim()).length} lines ready to connect
                </span>
              )}
            </div>
            <button
              type="submit"
              disabled={importing || !pasteText.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{importing ? 'Connecting…' : 'Connect User-Agents'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Pool Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(['all', 'Desktop', 'Mobile', 'Tablet'] as const).map((dt) => (
                <button
                  key={dt}
                  type="button"
                  onClick={() => setDeviceFilter(dt)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    deviceFilter === dt
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {dt === 'all' ? 'All' : dt}
                </button>
              ))}
            </div>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {filtered.length} connected
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search browser, OS, or string…"
                className="w-full h-9 pl-8 pr-3 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            {userAgents.length > 0 && (
              <button
                type="button"
                onClick={onClearAll}
                className="px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Clear All
              </button>
            )}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No User-Agents in pool yet. Paste strings above or click &ldquo;Load Desktop &amp; Mobile Presets&rdquo;.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500">
                  <th className="py-2.5 px-4">Device Class</th>
                  <th className="py-2.5 px-4">Browser &amp; OS</th>
                  <th className="py-2.5 px-4">Platform</th>
                  <th className="py-2.5 px-4">User-Agent String</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filtered.map((ua) => (
                  <tr key={ua.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-4 whitespace-nowrap font-medium text-slate-700">
                      <span className="inline-flex items-center gap-1.5">
                        {ua.deviceType === 'Mobile' ? (
                          <Smartphone className="h-3.5 w-3.5 text-slate-400" />
                        ) : ua.deviceType === 'Tablet' ? (
                          <Tablet className="h-3.5 w-3.5 text-slate-400" />
                        ) : (
                          <Monitor className="h-3.5 w-3.5 text-slate-400" />
                        )}
                        {ua.deviceType}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap text-slate-900 font-medium">
                      {ua.browser} {ua.browserVersion.split('.')[0]} · {ua.os} {ua.osVersion}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap font-mono text-slate-500">
                      {ua.platform}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-600 max-w-md truncate">
                      {ua.raw}
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onDelete(ua.id)}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded-md transition-colors"
                        aria-label="Remove User-Agent"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
