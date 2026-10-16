import { CSSProperties, ReactNode } from 'react';
import { colors, radius, shadows } from '../tokens';

/**
 * Sticky bottom action island (用户指示 2026-10-16).
 *
 * Pagination and bulk actions live in a floating bar pinned to the bottom of
 * the scrolling work area, so a long list never forces a scroll back to the
 * page top just to turn a page or act on a selection.
 *
 * Positioning note — this is why the component is not `position: fixed`:
 * the app shell scrolls `<main>` (AppLayout), not the window, and the context
 * rail is a *sibling* of `<main>`. `fixed` would align to the viewport and
 * paint over the left nav and the rail; `sticky` is clamped to the table
 * column automatically and follows the rail in and out of drawer mode.
 *
 * Therefore the island MUST be the last flow child of the page root element.
 * Nesting it inside a header is not equivalent — a sticky box cannot escape
 * its parent's box, so it would unstick the moment that header scrolls away.
 */
export interface ActionIslandProps {
  /** Top row, left: selection summary (e.g. “已选 12 单 · 跨分页保留”). */
  summary?: ReactNode;
  /** Top row, right: bulk action buttons. */
  actions?: ReactNode;
  /**
   * Bottom row, left: list totals (e.g. “共 83 单”). The top row is rendered
   * only when `summary`/`actions` are provided, so passing nothing here plus
   * no selection collapses the island to a single pagination row — the
   * “hide the selected-row count when nothing is selected” requirement.
   */
  leading?: ReactNode;
  /** Bottom row, right: pagination controls. */
  trailing?: ReactNode;
  /**
   * Extra distance held above the bottom edge of the scroll container (px).
   *
   * `<main>`'s own 24px padding-bottom already acts as the floor (measured in
   * Chrome, 1600×900: with 0 the island settles 24px above the viewport bottom,
   * left/right 233/1275 — pixel-identical to the table card, and clear of both
   * the 208px nav and the 300px rail). Raise it only for a deliberately airier
   * bar; a negative value tucks the island into that padding.
   */
  offset?: number;
  /** Render nothing at all (e.g. an empty result set). */
  hidden?: boolean;
  style?: CSSProperties;
}

export function ActionIsland({
  summary,
  actions,
  leading,
  trailing,
  offset = 0,
  hidden = false,
  style,
}: ActionIslandProps) {
  if (hidden) {
    return null;
  }
  // The primary border is the only state signal: it switches on with a
  // selection so the island reads as “armed” without turning into a second
  // card colour inside the flat workbench (task §66: no card in a card).
  const active = summary !== undefined || actions !== undefined;
  return (
    <div style={{ position: 'sticky', bottom: offset, zIndex: 20, marginTop: 16 }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          background: colors.container,
          border: `1px solid ${active ? colors.primary : colors.border}`,
          borderRadius: radius.card,
          boxShadow: shadows.overlay,
          padding: '9px 14px',
          ...style,
        }}
      >
        {active && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              paddingBottom: 9,
              marginBottom: 9,
              borderBottom: `1px solid ${colors.borderSoft}`,
            }}
          >
            {summary}
            {summary !== undefined && actions !== undefined && (
              <span style={{ flex: 1, minWidth: 8 }} />
            )}
            {actions}
          </div>
        )}
        {(leading !== undefined || trailing !== undefined) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
              minHeight: 32,
            }}
          >
            {leading}
            <span style={{ flex: 1, minWidth: 8 }} />
            {trailing}
          </div>
        )}
      </div>
    </div>
  );
}
