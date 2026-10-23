import { App, Button } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { colors } from '../tokens';

/**
 * 文本复制（2026-10-23，从订单页提取到 design-system）。
 *
 * clipboard API 在非安全上下文（局域网 http，用户实际访问方式）不可用，
 * 因此保留 execCommand 兜底。
 */
export function copyToClipboard(text: string): boolean {
  if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
    void navigator.clipboard.writeText(text).catch(() => undefined);
    return true;
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/**
 * 行内复制按钮：空值不渲染；点击不冒泡（避免触发行选中/展开）。
 *
 * 订单页的 SKU 名称、编码都是靠它复制的，其他页面（SKU 管理、采购、收货、
 * 库存…）展示 SKU 名称时统一用它，保证同一套交互与提示文案。
 */
export function CopyTextButton({
  value,
  title,
  size = 'small',
}: {
  value: string | null | undefined;
  title: string;
  size?: 'small' | 'middle';
}) {
  const { message } = App.useApp();
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return (
    <Button
      type="text"
      size={size}
      aria-label={`复制${title}`}
      title={`复制${title}`}
      style={{ padding: '0 4px', height: 18, minWidth: 18, color: colors.textTertiary }}
      onClick={(event) => {
        event.stopPropagation();
        const ok = copyToClipboard(value);
        if (ok) {
          void message.success(`${title}已复制`);
        } else {
          void message.error('复制失败，请手动选择文本复制');
        }
      }}
    >
      <CopyOutlined style={{ fontSize: 12 }} />
    </Button>
  );
}
