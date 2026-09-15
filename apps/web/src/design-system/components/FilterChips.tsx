import { ReactNode } from 'react';
import { Tooltip } from 'antd';
import { colors } from '../tokens';

/**
 * Mutually-exclusive chip group for secondary list filters (UI spec §6.4,
 * Phase 3 T1.2) — e.g. the order goods-state chips. Selected state uses the
 * primarySoft/danger token pairs; chips carrying risk semantics (`tone:
 * 'risk'`) keep the danger text colour even when unselected.
 */
export interface FilterChip {
  key: string;
  label: ReactNode;
  tooltip?: string;
  tone?: 'default' | 'risk';
  /** Chips with different groups are separated by a light divider. */
  group?: string;
}

export interface FilterChipsProps {
  chips: FilterChip[];
  /** Selected chip key; undefined means nothing is selected. */
  value?: string;
  /** Clicking the selected chip again clears the selection (undefined). */
  onChange: (key: string | undefined) => void;
}

export function FilterChips({ chips, value, onChange }: FilterChipsProps) {
  return (
    <div
      role="group"
      aria-label="筛选标签"
      style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
    >
      {chips.map((chip, index) => {
        const selected = chip.key === value;
        const risk = chip.tone === 'risk';
        const needsDivider =
          index > 0 && chip.group !== undefined && chip.group !== chips[index - 1]?.group;
        const button = (
          <button
            key={chip.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(selected ? undefined : chip.key)}
            style={{
              border: `1px solid ${
                selected ? (risk ? colors.dangerBorder : colors.infoBorder) : 'transparent'
              }`,
              borderRadius: 6,
              background: selected ? (risk ? colors.dangerBg : colors.primarySoft) : 'transparent',
              color: selected
                ? risk
                  ? colors.danger
                  : colors.primary
                : risk
                  ? colors.danger
                  : colors.textSecondary,
              fontWeight: selected ? 600 : 400,
              fontSize: 12.5,
              lineHeight: '20px',
              padding: '2px 10px',
              cursor: 'pointer',
            }}
          >
            {chip.label}
          </button>
        );
        return (
          <span key={chip.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {needsDivider && (
              <span aria-hidden style={{ width: 1, height: 14, background: colors.border }} />
            )}
            {chip.tooltip !== undefined ? <Tooltip title={chip.tooltip}>{button}</Tooltip> : button}
          </span>
        );
      })}
    </div>
  );
}
