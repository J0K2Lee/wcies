import { ReactNode, useEffect } from 'react';
import { typography } from '../tokens';

/**
 * Unified page header (task §55): title + description on the left, secondary
 * and primary actions on the right. Every redesigned page starts with this.
 */
export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned secondary action(s). */
  secondary?: ReactNode;
  /** Right-aligned primary action — at most one per page. */
  primary?: ReactNode;
  /** Extra row under the header (e.g. tabs) rendered full width. */
  extra?: ReactNode;
  /**
   * 浏览器标签页标题。默认取 `title`（字符串时）。
   * 2026-10-17 体检 P2-10：改造前全站 document.title 从不赋值，所有路由都叫
   * 「WCIES」，多标签页无法区分、书签与历史记录同名。
   */
  documentTitle?: string;
}

const APP_NAME = 'WCIES';

export function PageHeader({
  title,
  description,
  secondary,
  primary,
  extra,
  documentTitle,
}: PageHeaderProps) {
  const pageTitle =
    documentTitle ?? (typeof title === 'string' && title !== '' ? title : undefined);

  useEffect(() => {
    // 不写 cleanup：换页时新 PageHeader 的 effect 会覆盖旧标题，
    // 还原成 'WCIES' 反而会在过渡期闪一下。
    document.title = pageTitle === undefined ? APP_NAME : `${pageTitle} · ${APP_NAME}`;
  }, [pageTitle]);

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
        marginBottom: 20,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h1
          style={{
            margin: 0,
            fontSize: typography.pageTitle.size,
            fontWeight: typography.pageTitle.weight,
            lineHeight: typography.pageTitle.lineHeight,
            color: '#172033',
          }}
        >
          {title}
        </h1>
        {description !== undefined && (
          <p
            style={{
              margin: '6px 0 0',
              fontSize: 13.5,
              lineHeight: '20px',
              color: '#667085',
            }}
          >
            {description}
          </p>
        )}
      </div>
      {(secondary !== undefined || primary !== undefined) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
            paddingTop: 4,
          }}
        >
          {secondary}
          {primary}
        </div>
      )}
      {extra !== undefined && <div style={{ width: '100%' }}>{extra}</div>}
    </header>
  );
}
