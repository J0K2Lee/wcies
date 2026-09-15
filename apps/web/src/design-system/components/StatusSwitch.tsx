import { Popconfirm, Switch } from 'antd';
import { useState } from 'react';
import { colors } from '../tokens';

/**
 * Enable/disable toggle for the context rail (UI spec §5.2, Phase 3 T1.1).
 *
 * The ONLY entry point for ACTIVE/INACTIVE switching: one line in the rail's
 * summary section. Disabling asks for a one-step Popconfirm (the action stops
 * sync / selection); enabling executes immediately.
 */
export interface StatusSwitchProps {
  active: boolean;
  /** Used in the confirm copy: 「确认停用该{entityName}？」 */
  entityName: string;
  /** Popconfirm explanation of the consequence, e.g. "停用后不再同步". */
  disableHint?: string;
  loading?: boolean;
  onChange: (nextActive: boolean) => void;
}

export function StatusSwitch({
  active,
  entityName,
  disableHint,
  loading = false,
  onChange,
}: StatusSwitchProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '5px 0',
      }}
    >
      <span style={{ fontSize: 13, color: colors.textSecondary, flexShrink: 0 }}>状态</span>
      <Popconfirm
        open={confirmOpen}
        onOpenChange={(open) => {
          // Opening must come only from the disable branch in onClick below;
          // otherwise antd opens the popover on any child click (including
          // enable, which already ran) and cancelling looks like it failed.
          if (!open) setConfirmOpen(false);
        }}
        title={`确认停用该${entityName}？`}
        description={disableHint}
        okText="停用"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        onConfirm={() => onChange(false)}
      >
        {/* Controlled switch: the disable direction only flips after the
            Popconfirm confirms; enable runs straight through. */}
        <Switch
          checked={active}
          loading={loading}
          checkedChildren="启用"
          unCheckedChildren="停用"
          aria-label={`启用或停用该${entityName}`}
          onClick={(next) => {
            if (next) {
              onChange(true);
              return;
            }
            setConfirmOpen(true);
          }}
        />
      </Popconfirm>
    </div>
  );
}
