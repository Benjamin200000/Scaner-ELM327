import type { ParamStatus } from '@/core/engine/evaluate';
import { STATUS_LABEL } from '@/core/engine/evaluate';
import type { Support } from '@/core/capabilities';
import { SUPPORT_LABEL } from '@/core/capabilities';

/**
 * Indicadores de estado.
 *
 * El requisito es que el estado NUNCA dependa solo del color. Cada indicador
 * lleva texto, y la forma del punto cambia con el estado: lleno para falla,
 * anillo para atención, pequeño para normal, raya para sin dato. Así sirve
 * en pantalla con reflejo y para quien no distingue rojo de verde.
 */

const TONE: Record<ParamStatus, { color: string; glyph: string }> = {
  falla: { color: 'var(--color-fail)', glyph: '●' },
  atencion: { color: 'var(--color-warn)', glyph: '◐' },
  normal: { color: 'var(--color-ok)', glyph: '·' },
  'sin-referencia': { color: 'var(--color-info)', glyph: '?' },
  'fuera-de-condicion': { color: 'var(--color-idle)', glyph: '~' },
  'no-disponible': { color: 'var(--color-idle)', glyph: '–' },
  'no-compatible': { color: 'var(--color-idle)', glyph: '×' },
};

export function StatusChip({ status, compact = false }: {
  status: ParamStatus;
  compact?: boolean;
}) {
  const tone = TONE[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap"
      style={{ color: tone.color }}
      title={STATUS_LABEL[status]}
    >
      <span aria-hidden className="num" style={{ fontSize: 11, lineHeight: 1 }}>
        {tone.glyph}
      </span>
      {!compact && (
        <span style={{
          fontSize: 10, fontWeight: 600, letterSpacing: '0.07em',
        }}>
          {STATUS_LABEL[status]}
        </span>
      )}
      <span className="sr-only">{STATUS_LABEL[status]}</span>
    </span>
  );
}

const SUPPORT_TONE: Record<Support, string> = {
  compatible: 'var(--color-ok)',
  'no-compatible': 'var(--color-idle)',
  desconocido: 'var(--color-warn)',
};

export function SupportChip({ support }: { support: Support }) {
  return (
    <span
      style={{
        color: SUPPORT_TONE[support],
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {SUPPORT_LABEL[support]}
    </span>
  );
}

/** Punto de conexión: activa, trabajando o caída. */
export function LinkDot({ state }: { state: 'activa' | 'trabajando' | 'inactiva' | 'error' }) {
  const color =
    state === 'activa' ? 'var(--color-ok)'
    : state === 'trabajando' ? 'var(--color-warn)'
    : state === 'error' ? 'var(--color-fail)'
    : 'var(--color-idle)';
  return (
    <span
      aria-hidden
      style={{
        width: 7, height: 7, borderRadius: '50%', background: color,
        display: 'inline-block', flex: '0 0 auto',
      }}
    />
  );
}
