import { KeyboardEvent } from 'react';

/**
 * 让「可点击的表格行」对键盘与读屏可用（2026-10-17 体检 P2-9）。
 *
 * 改造前 32 处 `onRow={{ onClick }}` 只挂了鼠标事件：键盘用户无法选中/展开行，
 * 屏幕阅读器也不认为这些行可交互（WCAG 2.1 键盘可操作 / 名称角色值）。
 *
 * 用法：把返回值展开进 `onRow` 的返回对象。
 * ```tsx
 * onRow={(record) => ({
 *   onClick: activate,
 *   onDoubleClick: openDetail,
 *   ...rowInteractionProps({ selected: record.id === selectedId, onActivate: activate }),
 *   style: { cursor: 'pointer' },
 * })}
 * ```
 *
 * 说明：
 * - 故意**不覆盖 `role`**：`<tr>` 的隐式 role 是 row，覆盖成 button 反而破坏表语义；
 *   row 本身支持 `aria-selected`。
 * - 每行都进 Tab 序列，行很多时 Tab 需要多按几次。更讲究的做法是 roving tabindex
 *   （整表只保留一个 tab stop + 方向键移动），但那样每个表格都要额外状态管理；
 *   这里先取「可用且不引入新状态」的版本。
 */
export interface RowInteractionOptions {
  /** Mirrors the row's selected state for screen readers. */
  selected: boolean;
  /** Same action the mouse click performs. */
  onActivate: () => void;
  /** Optional accessible name, e.g. 「订单 49841173-0136-1」. */
  label?: string;
}

export function rowInteractionProps({ selected, onActivate, label }: RowInteractionOptions): {
  tabIndex: number;
  'aria-selected': boolean;
  'aria-label'?: string;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
} {
  return {
    tabIndex: 0,
    'aria-selected': selected,
    ...(label === undefined ? {} : { 'aria-label': label }),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        // 阻止 Space 滚动页面 / Enter 触发表单默认行为。
        event.preventDefault();
        onActivate();
      }
    },
  };
}
