import { describe, expect, it } from 'vitest';
import { quoteLongIntegers } from './ozon.client';

/**
 * int64 精度保护（2026-11-02）：OZON 聊天消息 id 实测 19 位
 * （`3000000467309489658`），纯 `JSON.parse` 会把它舍入成
 * `3000000467309489700`，增量水位与去重键全部错位。
 */
describe('quoteLongIntegers', () => {
  it('把 16 位以上整数变成字符串，保住全部数字', () => {
    const raw = '{"message_id":3000000467309489658,"chat_id":"c1"}';
    const parsed = JSON.parse(quoteLongIntegers(raw)) as { message_id: string; chat_id: string };
    expect(parsed.message_id).toBe('3000000467309489658');
    expect(parsed.chat_id).toBe('c1');
  });

  it('数组元素同样处理', () => {
    const raw = '{"ids":[3000000467309489658,3000000467309489659]}';
    const parsed = JSON.parse(quoteLongIntegers(raw)) as { ids: string[] };
    expect(parsed.ids).toEqual(['3000000467309489658', '3000000467309489659']);
  });

  it('短整数、金额与字符串不受影响', () => {
    const raw =
      '{"sku":3214646989,"price":410.5,"return_id":133492699,"text":"3000000467309489658号","qty":1}';
    const parsed = JSON.parse(quoteLongIntegers(raw)) as Record<string, unknown>;
    expect(parsed.sku).toBe(3214646989);
    expect(parsed.price).toBe(410.5);
    expect(parsed.return_id).toBe(133492699);
    expect(parsed.text).toBe('3000000467309489658号');
    expect(parsed.qty).toBe(1);
  });

  it('嵌套对象里的长整数同样加引号（chat/list 的 last_message_id 场景）', () => {
    const raw = '{"chats":[{"chat":{"chat_id":"c1"},"last_message_id":3000000467309489659}]}';
    const parsed = JSON.parse(quoteLongIntegers(raw)) as {
      chats: Array<{ last_message_id: string }>;
    };
    expect(parsed.chats[0]?.last_message_id).toBe('3000000467309489659');
  });
});
