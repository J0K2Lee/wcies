import { describe, expect, it } from 'vitest';
import { mapWbFeedback, mapWbQuestion, wbCardMatches } from './wb.mapper';

/**
 * WB 评价 / 提问映射（2026-11-02 实测形状：feedbacks-api）。
 *
 * WB 没有聊天 API——提问就是那边最主要的买家触达渠道，所以这两条映射直接
 * 决定「买家消息提醒」在 WB 上有没有意义。
 */
describe('mapWbFeedback', () => {
  it('productValuation → rating，text/pros/cons 拼正文，货号优先 supplierArticle', () => {
    const mapped = mapWbFeedback({
      id: '8iLsCn8E1VPINIYI7RFY',
      text: '鼠标不错',
      pros: '轻',
      cons: '电池一般',
      productValuation: 4,
      createdDate: '2026-10-16T20:14:50.699Z',
      orderStatus: 'buyout',
      wasViewed: true,
      photoLinks: ['https://x/1.jpg'],
      productDetails: {
        nmId: 1248557744,
        supplierArticle: 'K7 V2 Ultra+ - HEIJIN',
        brandName: 'MCHOSE',
      },
    });

    expect(mapped).toMatchObject({
      platformReviewId: '8iLsCn8E1VPINIYI7RFY',
      rating: 4,
      platformSkuId: 'K7 V2 Ultra+ - HEIJIN',
      bodyText: '鼠标不错 / 轻 / 电池一般',
      photosCount: 1,
      orderStatus: 'buyout',
      status: 'VIEWED',
    });
  });

  it('没有 supplierArticle 时退回 nmId；缺 id 返回 null', () => {
    const mapped = mapWbFeedback({
      id: 'fb-2',
      productValuation: 2,
      productDetails: { nmId: 987 },
    });
    expect(mapped?.platformSkuId).toBe('987');
    expect(mapped?.status).toBe('NEW');
    expect(mapWbFeedback({ productValuation: 5 })).toBeNull();
  });

  it('评分缺失保持 null（不猜 0）', () => {
    expect(mapWbFeedback({ id: 'fb-3', text: '无评分' })?.rating).toBeNull();
  });
});

describe('mapWbQuestion', () => {
  it('带回复的提问记录 answerText 与 answeredAt', () => {
    const mapped = mapWbQuestion({
      id: 'MC4IY6EB9EfFOuugMpv6',
      text: '什么时候发货？',
      createdDate: '2026-10-22T09:54:04.137964949Z',
      wasViewed: true,
      answer: { text: '已发出', createDate: '2026-10-23T03:15:40.681050383Z' },
      productDetails: { nmId: 1248557745, supplierArticle: 'K7 V2 Ultra+ - BAIJIN' },
    });

    expect(mapped).toMatchObject({
      platformQuestionId: 'MC4IY6EB9EfFOuugMpv6',
      bodyText: '什么时候发货？',
      answerText: '已发出',
      platformSkuId: 'K7 V2 Ultra+ - BAIJIN',
      wasViewed: true,
    });
    expect(mapped?.answeredAt).not.toBeNull();
  });

  it('未回复的提问 answerText=null，缺 id 返回 null', () => {
    const mapped = mapWbQuestion({ id: 'q-2', text: '有货吗', productDetails: { nmId: 5 } });
    expect(mapped?.answerText).toBeNull();
    expect(mapped?.answeredAt).toBeNull();
    expect(mapWbQuestion({ text: '无 id' })).toBeNull();
  });
});

/**
 * 定向卡片读取的精确匹配（2026-11-02）。
 *
 * WB `cards/list` 的 `textSearch` 是**模糊检索**（实测按货号能搜到目标卡，
 * 但也可能带回同名系列），所以 adapter 必须再用 vendorCode / nmID / 条码
 * 精确核对一遍，否则会把别人的链接当成这条订单行的商品页（AGENTS §88）。
 */
describe('wbCardMatches', () => {
  const card = {
    nmID: 2005318484,
    vendorCode: 'GRAVASTAR-MH1-PRO',
    sizes: [{ skus: ['2009259290673'] }],
  };

  it('按货号、nmID、条码任一精确命中', () => {
    expect(wbCardMatches(card, { offerId: 'GRAVASTAR-MH1-PRO' })).toBe(true);
    expect(wbCardMatches(card, { sellerSku: 'GRAVASTAR-MH1-PRO' })).toBe(true);
    expect(wbCardMatches(card, { platformProductId: '2005318484' })).toBe(true);
    expect(wbCardMatches(card, { platformSkuId: '2009259290673' })).toBe(true);
  });

  it('模糊搜到的相似卡片不算命中（避免张冠李戴）', () => {
    expect(wbCardMatches(card, { offerId: 'GRAVASTAR-MH1' })).toBe(false);
    expect(wbCardMatches(card, { platformSkuId: '2009259290674' })).toBe(false);
    expect(wbCardMatches(card, {})).toBe(false);
  });
});
