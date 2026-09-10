import { Dropdown } from 'antd';
import { MenuProps } from 'antd';
import { ReactNode } from 'react';
import { MoreOutlined } from '@ant-design/icons';

export interface ActionMenuProps {
  /** Primary link-style action shown next to the menu (task §53). */
  primary?: ReactNode;
  /** Dropdown items, usually the row's secondary operations. */
  items: MenuProps['items'];
  onOpenChange?: (open: boolean) => void;
}

/**
 * Unified row action cluster (task §53): "查看 / ⋯" or just "⋯" — never a row
 * of five buttons. The dropdown stops propagation so row clicks stay clean.
 */
export function ActionMenu({ primary, items }: ActionMenuProps) {
  return (
    <div
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
      onClick={(event) => event.stopPropagation()}
    >
      {primary}
      <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
        <button
          type="button"
          aria-label="更多操作"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            border: 'none',
            borderRadius: 6,
            background: 'transparent',
            color: '#667085',
            cursor: 'pointer',
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = '#F1F3F6';
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = 'transparent';
          }}
        >
          <MoreOutlined style={{ fontSize: 16 }} />
        </button>
      </Dropdown>
    </div>
  );
}
