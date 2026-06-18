import { useState, useEffect, useCallback } from 'preact/hooks';
import '../styles/automation-section.css';

interface Automation {
  slug: string;
  label: string;
  topic: string;
  description?: string;
  valueKey?: string;
  enabled: boolean;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      class={`automation-toggle ${checked ? 'automation-toggle--on' : 'automation-toggle--off'}`}
      onClick={onChange}
      aria-checked={checked}
      role="switch"
      aria-label={checked ? 'Enabled' : 'Disabled'}
    >
      <span class="automation-toggle__thumb" />
    </button>
  );
}

export function AutomationsSection() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAutomations = useCallback(async () => {
    try {
      const res = await fetch('/api/automations');
      const data = (await res.json()) as Automation[];
      if (Array.isArray(data)) {
        setAutomations(data);
        setError(null);
      } else {
        setError('Unexpected response');
      }
    } catch {
      setError('Failed to load automations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAutomations();
  }, [fetchAutomations]);

  const setEnabled = useCallback(async (slug: string, enabled: boolean) => {
    setAutomations(prev =>
      prev.map(a => (a.slug === slug ? { ...a, enabled } : a)),
    );

    try {
      const res = await fetch(`/api/automations/${slug}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error('Update failed');
    } catch {
      setAutomations(prev =>
        prev.map(a => (a.slug === slug ? { ...a, enabled: !enabled } : a)),
      );
      setError('Failed to update automation');
    }
  }, []);

  if (loading) return <div class="section-status">Loading…</div>;
  if (error) return <div class="section-status section-status--error">{error}</div>;
  if (automations.length === 0) return <div class="section-status">No automations configured</div>;

  return (
    <div class="automation-list">
      {automations.map(a => (
        <div class={`automation-card ${a.enabled ? '' : 'automation-card--disabled'}`} key={a.slug}>
          <div class="automation-card__main">
            <div class="automation-card__header">
              <span class="automation-card__label">{a.label}</span>
              <span class="automation-card__topic">{a.topic}</span>
            </div>
            {a.description && (
              <p class="automation-card__desc">{a.description}</p>
            )}
          </div>
          <div class="automation-card__control">
            <span class="automation-card__status">{a.enabled ? 'On' : 'Off'}</span>
            <Toggle checked={a.enabled} onChange={() => setEnabled(a.slug, !a.enabled)} />
          </div>
        </div>
      ))}
    </div>
  );
}
