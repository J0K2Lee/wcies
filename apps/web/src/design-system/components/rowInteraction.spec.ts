import { describe, expect, it, vi } from 'vitest';
import { KeyboardEvent } from 'react';
import { rowInteractionProps } from './rowInteraction';

/**
 * 行键盘可达性的回归保护（2026-10-17 体检 P2-9）。
 * 抽成纯函数后可以直接断言 props，不需要渲染整张表。
 */
function keydown(key: string): KeyboardEvent<HTMLElement> {
  return { key, preventDefault: vi.fn() } as unknown as KeyboardEvent<HTMLElement>;
}

describe('rowInteractionProps', () => {
  it('unselected row is focusable and reports aria-selected=false', () => {
    const props = rowInteractionProps({ selected: false, onActivate: () => {} });
    expect(props.tabIndex).toBe(0);
    expect(props['aria-selected']).toBe(false);
  });

  it('selected row reports aria-selected=true', () => {
    const props = rowInteractionProps({ selected: true, onActivate: () => {} });
    expect(props['aria-selected']).toBe(true);
  });

  it('Enter and Space both activate the row', () => {
    const onActivate = vi.fn();
    const props = rowInteractionProps({ selected: false, onActivate });

    const enter = keydown('Enter');
    props.onKeyDown(enter);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(enter.preventDefault).toHaveBeenCalled();

    const space = keydown(' ');
    props.onKeyDown(space);
    expect(onActivate).toHaveBeenCalledTimes(2);
    expect(space.preventDefault).toHaveBeenCalled();
  });

  it('other keys do not activate the row', () => {
    const onActivate = vi.fn();
    const props = rowInteractionProps({ selected: false, onActivate });
    props.onKeyDown(keydown('a'));
    props.onKeyDown(keydown('Tab'));
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('omits aria-label when no label is given, keeps it otherwise', () => {
    expect(
      rowInteractionProps({ selected: false, onActivate: () => {} })['aria-label'],
    ).toBeUndefined();
    expect(
      rowInteractionProps({ selected: false, onActivate: () => {}, label: '订单 123' })[
        'aria-label'
      ],
    ).toBe('订单 123');
  });
});
