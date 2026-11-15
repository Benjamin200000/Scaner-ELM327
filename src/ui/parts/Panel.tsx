import type { ReactNode } from 'react';

export function Panel({ title, aside, children, className = '' }: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title !== undefined && (
        <header className="panel-head">
          <h2 className="label" style={{ margin: 0 }}>{title}</h2>
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

export function Button({
  children, onClick, variant = 'normal', disabled = false, full = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'normal' | 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
  full?: boolean;
}) {
  const base: React.CSSProperties = {
    padding: '7px 14px',
    borderRadius: 3,
    border: '1px solid var(--color-line)',
    background: 'var(--color-panel-alt)',
    color: 'var(--color-ink)',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    width: full ? '100%' : undefined,
    opacity: disabled ? 0.4 : 1,
  };
  const tone: Record<string, React.CSSProperties> = {
    normal: {},
    primary: { background: '#1d3a4d', borderColor: '#2d5a76', color: '#cfe6f5' },
    danger: { background: '#3a1f1c', borderColor: '#5e322c', color: '#f0cdc8' },
    ghost: { background: 'transparent', borderColor: 'transparent', color: 'var(--color-ink-dim)' },
  };
  return (
    <button style={{ ...base, ...tone[variant] }} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/** Dato con etiqueta encima. Para cabeceras de identificación. */
export function Field({ label, value, mono = true }: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div style={{ minWidth: 0 }}>
      <div className="label">{label}</div>
      <div
        className={mono ? 'num' : undefined}
        style={{
          fontSize: 13,
          color: empty ? 'var(--color-ink-faint)' : 'var(--color-ink)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={typeof value === 'string' ? value : undefined}
      >
        {empty ? 'NO DISPONIBLE' : value}
      </div>
    </div>
  );
}

/** Aviso inline. Se usa para errores y para advertencias de alcance. */
export function Notice({ tone = 'info', title, children }: {
  tone?: 'info' | 'warn' | 'fail';
  title: string;
  children?: ReactNode;
}) {
  const color =
    tone === 'fail' ? 'var(--color-fail)'
    : tone === 'warn' ? 'var(--color-warn)'
    : 'var(--color-info)';
  return (
    <div
      style={{
        borderLeft: `2px solid ${color}`,
        background: 'var(--color-panel-alt)',
        padding: '8px 12px',
        borderRadius: 2,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color }}>{title}</div>
      {children !== undefined && (
        <div style={{ fontSize: 12, color: 'var(--color-ink-dim)', marginTop: 3 }}>
          {children}
        </div>
      )}
    </div>
  );
}
