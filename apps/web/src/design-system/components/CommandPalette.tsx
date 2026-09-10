import { useEffect, useMemo, useRef, useState } from 'react';
import { ReactNode } from 'react';
import { colors } from '../tokens';
import { fmtDateTime } from '../../utils/format';

/**
 * Command palette shell (Phase 2 task §30-§34, §52): centered modal with a
 * search input, quick actions, recent items and grouped results. Purely
 * presentational — data fetching and navigation live in the app layer
 * (GlobalSearch). Keyboard: ↑ ↓ move, Enter select, Esc close.
 */

export interface PaletteItem {
  key: string;
  icon: ReactNode;
  primary: string;
  secondary?: string;
  /** Entity type label, e.g. 订单 / SKU / 店铺. */
  type?: string;
  /** Optional status node (e.g. StatusBadge). */
  status?: ReactNode;
  /** ISO timestamp for recents rendering. */
  timestamp?: string;
  onSelect: () => void;
}

export interface PaletteSection {
  key: string;
  label: string;
  items: PaletteItem[];
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  keyword: string;
  onKeywordChange: (value: string) => void;
  loading?: boolean;
  /** Hint shown when keyword is shorter than the search threshold. */
  minLengthHint?: string;
  sections: PaletteSection[];
}

export function CommandPalette({
  open,
  onClose,
  keyword,
  onKeywordChange,
  loading = false,
  minLengthHint,
  sections,
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const flatItems = useMemo(() => sections.flatMap((section) => section.items), [sections]);

  useEffect(() => {
    if (open) {
      setActiveIndex(0);
      // Focus after the container mounts.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [keyword]);

  if (!open) {
    return null;
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (flatItems.length === 0 ? 0 : (index + 1) % flatItems.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) =>
        flatItems.length === 0 ? 0 : (index - 1 + flatItems.length) % flatItems.length,
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = flatItems[activeIndex];
      if (item !== undefined) {
        item.onSelect();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  let runningIndex = -1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="全局搜索"
      onKeyDown={onKeyDown}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
        background: 'rgba(23, 32, 51, 0.32)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 620,
          maxWidth: '92vw',
          maxHeight: '64vh',
          display: 'flex',
          flexDirection: 'column',
          background: colors.container,
          border: `1px solid ${colors.border}`,
          borderRadius: 12,
          boxShadow: '0 6px 24px rgba(23, 32, 51, 0.10)',
          overflow: 'hidden',
        }}
      >
        {/* Search input */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '14px 18px',
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <span aria-hidden style={{ color: colors.textTertiary, fontSize: 15 }}>
            ⌕
          </span>
          <input
            ref={inputRef}
            value={keyword}
            onChange={(event) => onKeywordChange(event.target.value)}
            placeholder="搜索订单、SKU、店铺…"
            aria-label="搜索关键词"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              fontSize: 15,
              color: colors.textPrimary,
              background: 'transparent',
            }}
          />
          {loading && (
            <span
              aria-label="搜索中"
              style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                border: `2px solid ${colors.border}`,
                borderTopColor: colors.primary,
                animation: 'wcies-spin 0.7s linear infinite',
              }}
            />
          )}
          <kbd
            style={{
              fontSize: 11,
              color: colors.textTertiary,
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              padding: '0 5px',
              lineHeight: '18px',
              background: '#FAFBFC',
            }}
          >
            Esc
          </kbd>
        </div>

        {/* Sections */}
        <div style={{ overflowY: 'auto', padding: '6px 0' }}>
          {sections.every((section) => section.items.length === 0) && (
            <div
              style={{
                padding: '36px 24px',
                textAlign: 'center',
                color: colors.textTertiary,
                fontSize: 13,
              }}
            >
              {minLengthHint ?? '没有匹配的结果'}
            </div>
          )}
          {sections.map((section) => {
            if (section.items.length === 0) {
              return null;
            }
            return (
              <div key={section.key}>
                <div
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: colors.textTertiary,
                    letterSpacing: 0.4,
                    padding: '8px 18px 4px',
                  }}
                >
                  {section.label}
                </div>
                {section.items.map((item) => {
                  runningIndex += 1;
                  const isActive = runningIndex === activeIndex;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onMouseEnter={() => setActiveIndex(runningIndex)}
                      onClick={item.onSelect}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        width: '100%',
                        padding: '8px 18px',
                        border: 'none',
                        textAlign: 'left',
                        cursor: 'pointer',
                        background: isActive ? colors.primarySoft : 'transparent',
                      }}
                    >
                      <span
                        aria-hidden
                        style={{ display: 'inline-flex', color: colors.textTertiary, fontSize: 15 }}
                      >
                        {item.icon}
                      </span>
                      <span
                        style={{
                          fontSize: 13.5,
                          fontWeight: 550,
                          color: colors.textPrimary,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.primary}
                      </span>
                      {item.secondary !== undefined && (
                        <span
                          style={{
                            fontSize: 12.5,
                            color: colors.textTertiary,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            flex: 1,
                          }}
                        >
                          {item.secondary}
                        </span>
                      )}
                      {item.timestamp !== undefined && (
                        <span style={{ fontSize: 11.5, color: colors.textTertiary }}>
                          {fmtDateTime(item.timestamp)}
                        </span>
                      )}
                      {item.type !== undefined && (
                        <span
                          style={{
                            fontSize: 11,
                            color: colors.textTertiary,
                            border: `1px solid ${colors.border}`,
                            borderRadius: 4,
                            padding: '0 5px',
                            lineHeight: '18px',
                            flexShrink: 0,
                          }}
                        >
                          {item.type}
                        </span>
                      )}
                      {item.status}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Footer hint */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '8px 18px',
            borderTop: `1px solid ${colors.borderSoft}`,
            fontSize: 11.5,
            color: colors.textTertiary,
          }}
        >
          <span>↑ ↓ 选择</span>
          <span>Enter 打开</span>
          <span>Esc 关闭</span>
          <span style={{ marginLeft: 'auto' }}>至少输入 2 个字符开始搜索</span>
        </div>
      </div>
    </div>
  );
}
