import { Alert, Checkbox, Modal } from 'antd';
import { useEffect, useState } from 'react';

export interface DeleteConfirmModalProps {
  open: boolean;
  title: string;
  /** What will be removed, and what the backend does by default. */
  description: string;
  /**
   * Label for the force option, e.g. "强制删除（同时删除关联的 3 个 SKU 及其映射）".
   * Omit to hide the option entirely (entities with no cascade behaviour).
   */
  forceLabel?: string;
  /** Shown when force is ticked: what force can still NOT do. */
  forceWarning?: string;
  confirmLoading?: boolean;
  onConfirm: (force: boolean) => void;
  onCancel: () => void;
}

/**
 * Shared delete confirmation (Sprint 6).
 *
 * One dialog for every entity so the wording, the force checkbox and the
 * warning behave identically across 商品 / SKU / 映射 / 店铺 — the seller should
 * never have to relearn what "删除" does per page.
 *
 * Forcing only ever cascades MASTER DATA (SKUs, barcodes, images, mappings).
 * Business history (inventory ledger, order lines, picking, shipment) always
 * blocks the delete, and the backend returns the reason - the warning below
 * tells the user that up front instead of letting them discover it by failing.
 */
export function DeleteConfirmModal({
  open,
  title,
  description,
  forceLabel,
  forceWarning,
  confirmLoading,
  onConfirm,
  onCancel,
}: DeleteConfirmModalProps) {
  const [force, setForce] = useState(false);

  // Never carry a tick into the next dialog: each delete starts unchecked.
  useEffect(() => {
    if (!open) {
      setForce(false);
    }
  }, [open]);

  return (
    <Modal
      title={title}
      open={open}
      okText={force ? '强制删除' : '删除'}
      okButtonProps={{ danger: true }}
      cancelText="取消"
      confirmLoading={confirmLoading}
      onOk={() => onConfirm(force)}
      onCancel={onCancel}
      destroyOnHidden
    >
      <p style={{ marginBottom: forceLabel === undefined ? 0 : 12 }}>{description}</p>
      {forceLabel !== undefined && (
        <>
          <Checkbox checked={force} onChange={(event) => setForce(event.target.checked)}>
            {forceLabel}
          </Checkbox>
          {force && forceWarning !== undefined && (
            <Alert type="warning" showIcon style={{ marginTop: 12 }} title={forceWarning} />
          )}
        </>
      )}
    </Modal>
  );
}
