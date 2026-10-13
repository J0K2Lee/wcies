import { afterEach, describe, expect, it, vi } from 'vitest';
import { printTasksBrowser } from './print-browser';

/**
 * Regression test: window.open('', '_blank', 'noopener') RETURNS NULL in
 * modern browsers, so the handle was lost, document.write never ran and the
 * user was left with a blank tab. The fix drops noopener and severs the
 * opener link manually instead.
 */
describe('printTasksBrowser', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeFakeWindow() {
    return {
      opener: { stale: true },
      document: { write: vi.fn(), close: vi.fn() },
      focus: vi.fn(),
      setTimeout: vi.fn(),
    };
  }

  it('writes the rendered label HTML into the opened window', () => {
    const fake = makeFakeWindow();
    const open = vi.fn(() => fake);
    vi.stubGlobal('window', { open });

    printTasksBrowser([
      {
        type: 'SKU_LABEL',
        payload: { barcode: 'GUI-DEMO-69CODE', skuName: '测试商品', copies: 1 },
      },
    ]);

    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith('', '_blank');
    const html = fake.document.write.mock.calls[0]?.[0] as string;
    expect(html).toContain('GUI-DEMO-69CODE');
    expect(html).toContain('测试商品');
    expect(html).toContain('<svg');
    // SKU codes are deliberately NOT printed on labels (2026-10-09).
    expect(html).not.toContain('class="s"');
    // The printed page must carry ONLY the label: zero page margin so
    // Chromium does not draw its date/title/URL/page-number header/footer.
    expect(html).toContain('@page { margin: 0; }');
    expect(html).not.toContain('WCIES');
    expect(fake.document.close).toHaveBeenCalledOnce();
    // Security hygiene: the popup must not keep an opener link.
    expect(fake.opener).toBeNull();
  });

  it('renders one label per copy', () => {
    const fake = makeFakeWindow();
    const open = vi.fn(() => fake);
    vi.stubGlobal('window', { open });

    printTasksBrowser([{ type: 'BIN_LABEL', payload: { binCode: 'ZG-01-A01-1', copies: 3 } }]);

    const html = fake.document.write.mock.calls[0]?.[0] as string;
    expect(html.match(/class="label"/g)).toHaveLength(3);
  });

  it('opens nothing when there are no label tasks', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });

    printTasksBrowser([]);

    expect(open).not.toHaveBeenCalled();
  });

  it('does not throw when the popup is blocked (open returns null)', () => {
    vi.stubGlobal('window', { open: vi.fn(() => null) });

    expect(() =>
      printTasksBrowser([{ type: 'BIN_LABEL', payload: { binCode: 'ZG-01-A01-1', copies: 1 } }]),
    ).not.toThrow();
  });
});
