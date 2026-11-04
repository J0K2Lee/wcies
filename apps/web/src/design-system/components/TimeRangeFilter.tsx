import { useState } from 'react';
import { DatePicker, Select, Space } from 'antd';

/**
 * 时间范围筛选控件（2026-11-04 用户需求：时间类型与区间必须连在一起）。
 *
 * antd 没有现成的「时间轴 + 区间」合并控件；这里用 `Space.Compact` 把两者
 * 拼成一个连体控件（共享边框、同一高度），并统一交互：
 * - 切换时间类型不会清空已选区间（同一段时间换个轴看）；
 * - 清空区间即取消时间筛选；
 * - 值以 ISO 字符串向外抛（`DatePicker` 内部用 dayjs，但页面不必依赖它）。
 *
 * 供订单等列表页复用；不要在各页面各写一套「Select + RangePicker」。
 */
export interface TimeRangeFieldOption {
  value: string;
  label: string;
}

export interface TimeRangeChangeValue {
  field: string;
  /** 起（ISO，含）；未选为 undefined。 */
  from?: string;
  /** 止（ISO，含）；未选为 undefined。 */
  to?: string;
}

export interface TimeRangeFilterProps {
  /** 当前时间轴字段（受控）。 */
  field: string;
  fieldOptions: TimeRangeFieldOption[];
  /** 字段或区间任一变化都会带上完整快照。 */
  onChange: (next: TimeRangeChangeValue) => void;
  /** 变化时清空已选区间（父级「重置筛选」用）。 */
  resetKey?: number;
  fieldWidth?: number;
  rangeWidth?: number;
}

export function TimeRangeFilter({
  field,
  fieldOptions,
  onChange,
  resetKey = 0,
  fieldWidth = 118,
  rangeWidth = 300,
}: TimeRangeFilterProps) {
  const [range, setRange] = useState<{ from?: string; to?: string }>({});

  return (
    <Space.Compact>
      <Select
        value={field}
        options={fieldOptions}
        style={{ width: fieldWidth }}
        onChange={(value: string) => onChange({ field: value, ...range })}
      />
      <DatePicker.RangePicker
        // resetKey 变化 → 重新挂载，清掉已选区间（RangePicker 是内部态）。
        key={resetKey}
        showTime={{ format: 'HH:mm' }}
        format="YYYY-MM-DD HH:mm"
        placeholder={['开始时间', '结束时间']}
        style={{ width: rangeWidth }}
        onChange={(dates) => {
          const next = {
            from: dates?.[0]?.toISOString(),
            to: dates?.[1]?.toISOString(),
          };
          setRange(next);
          onChange({ field, ...next });
        }}
      />
    </Space.Compact>
  );
}
