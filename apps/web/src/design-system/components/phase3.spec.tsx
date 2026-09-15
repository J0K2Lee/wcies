import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App as AntdApp } from 'antd';
import {
  FilterChips,
  KpiRow,
  RailHint,
  RawDataBlock,
  StatusSwitch,
  IMPORT_STATUS_LABEL,
  IMPORT_STATUS_META,
  INTERCEPTION_STATUS_LABEL,
  INTERCEPTION_STATUS_META,
  NOTIFICATION_STATUS_META,
  NOTIFICATION_TYPE_META,
  PACKAGE_STATUS_LABEL,
  PACKAGE_STATUS_META,
  RESERVATION_STATUS_LABEL,
  RESERVATION_STATUS_META,
  RETURN_BATCH_STATUS_META,
  RETURN_CONDITION_META,
  SHIPMENT_STATUS_LABEL,
  SHIPMENT_STATUS_META,
  TRANSACTION_TYPE_LABEL,
  TRANSACTION_TYPE_META,
  StatusMeta,
} from '../index';

/**
 * Phase 3 T1 basic render/data assertions. Rendering uses renderToStaticMarkup
 * (node environment, no extra test dependencies); interaction-level behaviour
 * (confirm flows) stays covered by the T8 manual checklist.
 */

describe('StatusSwitch (T1.1)', () => {
  it('renders the 状态 label row with an enabled switch', () => {
    const html = renderToStaticMarkup(
      <StatusSwitch active={true} entityName="店铺" onChange={() => undefined} />,
    );
    expect(html).toContain('状态');
    expect(html).toContain('aria-label="启用或停用该店铺"');
  });

  it('renders the unchecked state when inactive', () => {
    const html = renderToStaticMarkup(
      <StatusSwitch active={false} entityName="仓库" onChange={() => undefined} />,
    );
    expect(html).toContain('role="switch"');
  });
});

describe('FilterChips (T1.2)', () => {
  const chips = [
    { key: 'ALL', label: '全部', group: 'flow' },
    { key: 'TO_PICK', label: '待拣货', group: 'flow' },
    { key: 'BACKORDERED', label: '缺货', tone: 'risk' as const, group: 'risk' },
  ];

  it('renders every chip and marks the selected one aria-pressed', () => {
    const html = renderToStaticMarkup(
      <FilterChips chips={chips} value="TO_PICK" onChange={() => undefined} />,
    );
    expect(html).toContain('全部');
    expect(html).toContain('待拣货');
    expect(html).toContain('缺货');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
  });

  it('inserts a divider between different groups', () => {
    const html = renderToStaticMarkup(
      <FilterChips chips={chips} value={undefined} onChange={() => undefined} />,
    );
    // one divider between the flow group and the risk group
    expect(html.match(/aria-hidden/g)?.length).toBe(1);
  });
});

describe('KpiRow (T1.3)', () => {
  it('lays children out on the standard responsive grid', () => {
    const html = renderToStaticMarkup(
      <KpiRow>
        <span>a</span>
        <span>b</span>
      </KpiRow>,
    );
    expect(html).toContain('minmax(210px, 1fr)');
    expect(html).toContain('<span>a</span>');
  });
});

describe('RailHint (T1.4)', () => {
  it('renders quiet hint text', () => {
    const html = renderToStaticMarkup(<RailHint>点击订单行快速预览</RailHint>);
    expect(html).toContain('点击订单行快速预览');
  });
});

describe('RawDataBlock (T1.5)', () => {
  it('pretty-prints the payload in a pre block with a copy button', () => {
    const html = renderToStaticMarkup(
      <AntdApp>
        <RawDataBlock data={{ id: 'MOCK-A-001' }} />
      </AntdApp>,
    );
    expect(html).toContain('<pre');
    expect(html).toContain('&quot;id&quot;: &quot;MOCK-A-001&quot;');
    expect(html).toContain('aria-label="复制 JSON"');
  });

  it('renders non-JSON values without crashing', () => {
    const html = renderToStaticMarkup(
      <AntdApp>
        <RawDataBlock data={null} />
      </AntdApp>,
    );
    expect(html).toContain('<pre');
  });
});

describe('Status META tables (G3)', () => {
  const tables: Array<[string, Record<string, StatusMeta>]> = [
    ['IMPORT_STATUS_META', IMPORT_STATUS_META],
    ['INTERCEPTION_STATUS_META', INTERCEPTION_STATUS_META],
    ['SHIPMENT_STATUS_META', SHIPMENT_STATUS_META],
    ['PACKAGE_STATUS_META', PACKAGE_STATUS_META],
    ['RESERVATION_STATUS_META', RESERVATION_STATUS_META],
    ['TRANSACTION_TYPE_META', TRANSACTION_TYPE_META],
    ['RETURN_BATCH_STATUS_META', RETURN_BATCH_STATUS_META],
    ['RETURN_CONDITION_META', RETURN_CONDITION_META],
    ['NOTIFICATION_STATUS_META', NOTIFICATION_STATUS_META],
    ['NOTIFICATION_TYPE_META', NOTIFICATION_TYPE_META],
  ];
  const TONES = ['success', 'warning', 'danger', 'info', 'neutral', 'purple'];

  it.each(tables)('%s has tone + non-empty label for every entry', (_name, table) => {
    expect(Object.keys(table).length).toBeGreaterThan(0);
    for (const [key, meta] of Object.entries(table)) {
      expect(TONES, `${key} tone`).toContain(meta.tone);
      expect(meta.label, `${key} label`).toBeTruthy();
    }
  });

  it('keeps legacy label views derived from the META tables (no drift)', () => {
    const pairs: Array<[Record<string, string>, Record<string, StatusMeta>]> = [
      [IMPORT_STATUS_LABEL, IMPORT_STATUS_META],
      [INTERCEPTION_STATUS_LABEL, INTERCEPTION_STATUS_META],
      [SHIPMENT_STATUS_LABEL, SHIPMENT_STATUS_META],
      [PACKAGE_STATUS_LABEL, PACKAGE_STATUS_META],
      [RESERVATION_STATUS_LABEL, RESERVATION_STATUS_META],
      [TRANSACTION_TYPE_LABEL, TRANSACTION_TYPE_META],
    ];
    for (const [labels, meta] of pairs) {
      for (const [key, value] of Object.entries(labels)) {
        expect(value).toBe(meta[key]?.label);
      }
    }
  });
});
