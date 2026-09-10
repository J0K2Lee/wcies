import { createContext, useContext, useEffect } from 'react';
import { ReactNode } from 'react';
import { colors } from '../tokens';

/**
 * Unified context rail primitives (task §57). One rail frame for the whole
 * app — pages register sections via useContextRail() instead of hand-rolling
 * a second layout per page.
 */

export interface ContextSectionProps {
  title: ReactNode;
  /** Small right-aligned hint (e.g. "3 项"). */
  extra?: ReactNode;
  children: ReactNode;
}

export function ContextSection({ title, extra, children }: ContextSectionProps) {
  return (
    <section
      style={{
        padding: '14px 18px 16px',
        borderBottom: `1px solid ${colors.borderSoft}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: colors.textTertiary,
            letterSpacing: 0.3,
          }}
        >
          {title}
        </span>
        {extra !== undefined && (
          <span style={{ fontSize: 12, color: colors.textTertiary }}>{extra}</span>
        )}
      </div>
      {children}
    </section>
  );
}

export interface ContextMetricProps {
  label: ReactNode;
  value: ReactNode;
  /** Emphasis for the primary metric of a group (e.g. Available). */
  strong?: boolean;
  onClick?: () => void;
}

export function ContextMetric({ label, value, strong = false, onClick }: ContextMetricProps) {
  return (
    <div
      onClick={onClick}
      role={onClick === undefined ? undefined : 'button'}
      tabIndex={onClick === undefined ? undefined : 0}
      onKeyDown={
        onClick === undefined
          ? undefined
          : (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick();
              }
            }
      }
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
        padding: '5px 0',
        cursor: onClick === undefined ? undefined : 'pointer',
      }}
    >
      <span style={{ fontSize: 13, color: colors.textSecondary, flexShrink: 0 }}>{label}</span>
      <span
        style={{
          fontSize: 13.5,
          fontWeight: strong ? 650 : 500,
          color: strong ? colors.textPrimary : colors.textSecondary,
          fontVariantNumeric: 'tabular-nums',
          textAlign: 'right',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
    </div>
  );
}

/** Full-width quiet action at the rail bottom (e.g. 打开完整详情). */
export function ContextAction({ children }: { children: ReactNode }) {
  return <div style={{ padding: '12px 18px 14px' }}>{children}</div>;
}

/** What a page registers into the shell's context rail. */
export interface ContextRailContent {
  /** Rail header above sections, e.g. the selected entity name. */
  header?: ReactNode;
  /** Sections rendered inside the rail frame. */
  children: ReactNode;
  /** Table-heavy pages may collapse by default on mid-width screens (§17). */
  defaultCollapsed?: boolean;
}

type RailSetter = (content: ContextRailContent | null) => void;

const RailSetterContext = createContext<RailSetter | null>(null);

/** Shell-side provider: AppLayout injects the setter that receives content. */
export const AppRailSetterProvider = RailSetterContext.Provider;

/**
 * Page-side hook: registers rail content for as long as the page is mounted.
 * Memoize `content` in the caller so it only re-registers on real changes.
 */
export function useContextRail(content: ContextRailContent | null): void {
  const setter = useContext(RailSetterContext);
  useEffect(() => {
    if (setter === null) {
      return;
    }
    setter(content);
    return () => setter(null);
  }, [setter, content]);
}
