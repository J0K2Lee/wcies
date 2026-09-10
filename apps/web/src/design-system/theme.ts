import { ThemeConfig } from 'antd';
import { colors, radius, shadows, typography } from './tokens';

/**
 * The single WCIES AntD theme (task §11). Every page renders inside one
 * ConfigProvider — per-page theme overrides are forbidden. Component tokens
 * map the neutral business language onto Menu / Table / Drawer / Modal etc.
 */
export const wciesTheme: ThemeConfig = {
  token: {
    colorPrimary: colors.primary,
    colorInfo: colors.info,
    colorSuccess: colors.success,
    colorWarning: colors.warning,
    colorError: colors.danger,

    colorBgLayout: colors.canvas,
    colorBgContainer: colors.container,
    colorText: colors.textPrimary,
    colorTextSecondary: colors.textSecondary,
    colorTextTertiary: colors.textTertiary,
    colorBorder: colors.border,
    colorBorderSecondary: colors.borderSoft,

    borderRadius: radius.button,
    borderRadiusLG: radius.card,
    controlHeight: 32,
    fontSize: typography.body.size,
    fontFamily: typography.fontFamily,
    boxShadow: shadows.card,
    boxShadowSecondary: '0 4px 16px rgba(23, 32, 51, 0.08)',
  },
  components: {
    Menu: {
      itemHeight: 38,
      itemMarginInline: 8,
      itemMarginBlock: 2,
      itemBorderRadius: 8,
      itemSelectedBg: colors.primarySoft,
      itemSelectedColor: colors.primaryActive,
      itemColor: colors.textSecondary,
      itemHoverBg: '#F4F6F9',
      subMenuItemBg: 'transparent',
      groupTitleFontSize: 12,
      activeBarBorderWidth: 0,
    },
    Table: {
      headerBg: '#F8F9FB',
      headerColor: colors.textSecondary,
      headerSplitColor: 'transparent',
      rowHoverBg: '#F7F9FB',
      cellPaddingBlock: 13,
      cellFontSize: typography.body.size,
      borderColor: colors.borderSoft,
    },
    Button: {
      borderRadius: radius.button,
      controlHeight: 32,
      fontWeight: 500,
    },
    Input: {
      borderRadius: radius.input,
    },
    Select: {
      borderRadius: radius.input,
    },
    Tag: {
      borderRadiusSM: radius.tag,
    },
    Card: {
      borderRadiusLG: radius.card,
      paddingLG: 20,
    },
    Tabs: {
      titleFontSize: 14,
      horizontalItemPadding: '10px 4px',
      inkBarColor: colors.primary,
      itemSelectedColor: colors.primaryActive,
    },
    Drawer: {
      borderRadiusLG: 0,
    },
    Modal: {
      borderRadiusLG: 12,
    },
    Progress: {
      defaultColor: colors.primary,
    },
  },
};
