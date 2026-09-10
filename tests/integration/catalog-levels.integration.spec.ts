import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * Sprint 6 three-level category semantics (decision 0005) + brand naming
 * (decision 0006) against real PostgreSQL: depth limits incl. whole-subtree
 * height, product level-3 rule, same-parent name uniqueness (roots included),
 * subtree level shifts on re-parent, subtree product filtering.
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3111';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();

interface CategoryDto {
  id: string;
  parentId: string | null;
  nameZh: string;
  level: number;
}

async function createCategory(
  body: Record<string, unknown>,
): Promise<{ status: number; data: CategoryDto; code?: string }> {
  const response = await client.post<CategoryDto>('/api/v1/categories', body);
  return {
    status: response.status,
    data: response.body.data,
    code: response.body.error?.code,
  };
}

beforeAll(async () => {
  api = spawnApiEntry('main.js', { PORT: '3111', REDIS_URL: 'redis://localhost:6379/6' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();
});

afterAll(async () => {
  await api.stop();
});

describe('category depth limits (decision 0005 §9.4)', () => {
  it('builds 3 levels; rejects a 4th level', async () => {
    const l1 = await createCategory({ nameZh: `${PREFIX} 数码` });
    expect(l1.status).toBe(201);
    const l2 = await createCategory({ parentId: l1.data.id, nameZh: `${PREFIX} 外设` });
    expect(l2.data.level).toBe(2);
    const l3 = await createCategory({ parentId: l2.data.id, nameZh: `${PREFIX} 键盘` });
    expect(l3.data.level).toBe(3);

    const l4 = await createCategory({ parentId: l3.data.id, nameZh: `${PREFIX} 机械键盘` });
    expect(l4.status).toBe(422);
    expect(l4.code).toBe('CATEGORY_DEPTH_EXCEEDED');
  });

  it('scenario A: L1 under L1 is legal; L2 under L3 would be level 4 - rejected', async () => {
    const hostL1 = await createCategory({ nameZh: `${PREFIX} 宿主一级` });
    const otherL1 = await createCategory({ nameZh: `${PREFIX} 另一个一级` });
    const otherL2 = await createCategory({ parentId: otherL1.data.id, nameZh: `${PREFIX} 线材` });
    expect(otherL2.data.level).toBe(2);

    // Legal: the other L1 becomes an L2 under hostL1 (no children, no products).
    const legal = await client.patch<CategoryDto>(`/api/v1/categories/${otherL1.data.id}`, {
      parentId: hostL1.data.id,
    });
    expect(legal.body.data.level).toBe(2);

    // Now its child sits at level 3 already; hanging it under a level-3 node
    // would make it level 4.
    const someL3parent = await createCategory({
      parentId: hostL1.data.id,
      nameZh: `${PREFIX} 三级宿主`,
    });
    // someL3parent is currently level 2; push it to level 3 under a new L2
    const midL2 = await createCategory({ parentId: hostL1.data.id, nameZh: `${PREFIX} 中间二级` });
    const pushed = await client.patch<CategoryDto>(`/api/v1/categories/${someL3parent.data.id}`, {
      parentId: midL2.data.id,
    });
    expect(pushed.body.data.level).toBe(3);

    const illegal = await client.patch(`/api/v1/categories/${otherL2.data.id}`, {
      parentId: someL3parent.data.id,
    });
    expect(illegal.status).toBe(422);
    expect(illegal.body.error?.code).toBe('CATEGORY_DEPTH_EXCEEDED');
  });

  it('scenario B: re-parenting a whole 3-level subtree under an L1 is rejected', async () => {
    const treeL1 = await createCategory({ nameZh: `${PREFIX} 整树一级` });
    const treeL2 = await createCategory({ parentId: treeL1.data.id, nameZh: `${PREFIX} 整树二级` });
    await createCategory({ parentId: treeL2.data.id, nameZh: `${PREFIX} 整树三级` });
    // subtree height of treeL1 = 3; under another L1 -> 1 + 3 = 4 levels.
    const otherL1 = await createCategory({ nameZh: `${PREFIX} 整树目标一级` });
    const rejected = await client.patch(`/api/v1/categories/${treeL1.data.id}`, {
      parentId: otherL1.data.id,
    });
    expect(rejected.status).toBe(422);
    expect(rejected.body.error?.code).toBe('CATEGORY_DEPTH_EXCEEDED');
  });

  it('re-parent shifts the whole subtree consistently', async () => {
    const rootA = await createCategory({ nameZh: `${PREFIX} 移动源一级` });
    const leafL2 = await createCategory({ parentId: rootA.data.id, nameZh: `${PREFIX} 移动叶子` });
    expect(leafL2.data.level).toBe(2);

    // L2 -> root: becomes L1 (delta -1), no children, no products.
    const moved = await client.patch<CategoryDto>(`/api/v1/categories/${leafL2.data.id}`, {
      parentId: null,
    });
    expect(moved.body.data.level).toBe(1);
    expect(moved.body.data.parentId).toBeNull();

    const subtreeCase = await createCategory({ nameZh: `${PREFIX} 带子移动二级` });
    const subL2 = await createCategory({
      parentId: subtreeCase.data.id,
      nameZh: `${PREFIX} 带子移动子级`,
    });
    expect(subL2.data.level).toBe(2);
    // Move subtreeCase (height 2) under another L1: newLevel 2 + 1 = 3 OK;
    // child must shift to 3 in the same transaction.
    const targetL1 = await createCategory({ nameZh: `${PREFIX} 带子移动目标` });
    const movedTree = await client.patch<CategoryDto>(
      `/api/v1/categories/${subtreeCase.data.id}`,
      { parentId: targetL1.data.id },
    );
    expect(movedTree.body.data.level).toBe(2);
    const tree = await client.get<Array<CategoryDto & { children: CategoryDto[] }>>(
      '/api/v1/categories',
    );
    const movedNode = tree.body.data
      .find((node) => node.id === targetL1.data.id)
      ?.children.find((node) => node.id === subtreeCase.data.id);
    expect(movedNode?.level).toBe(2);
    const child = movedNode?.children.find((node) => node.id === subL2.data.id);
    expect(child?.level).toBe(3);
  });
});

describe('products only reference level-3 categories', () => {
  let l1 = '';
  let l2 = '';
  let l3 = '';

  beforeAll(async () => {
    const r1 = await createCategory({ nameZh: `${PREFIX} 商品一级` });
    l1 = r1.data.id;
    const r2 = await createCategory({ parentId: l1, nameZh: `${PREFIX} 商品二级` });
    l2 = r2.data.id;
    const r3 = await createCategory({ parentId: l2, nameZh: `${PREFIX} 商品三级` });
    l3 = r3.data.id;
  });

  it('rejects products on level 1 / level 2; accepts level 3', async () => {
    const onL1 = await client.post('/api/v1/products', {
      nameZh: `${PREFIX} 挂一级商品`,
      categoryId: l1,
    });
    expect(onL1.status).toBe(422);
    expect(onL1.body.error?.code).toBe('CATEGORY_LEVEL_INVALID');

    const onL2 = await client.post('/api/v1/products', {
      nameZh: `${PREFIX} 挂二级商品`,
      categoryId: l2,
    });
    expect(onL2.status).toBe(422);

    const onL3 = await client.post<{ id: string }>('/api/v1/products', {
      nameZh: `${PREFIX} 挂三级商品`,
      categoryId: l3,
    });
    expect(onL3.body.success).toBe(true);
  });

  it('scenario C: a level-3 category carrying products cannot be re-leveled', async () => {
    const moved = await client.patch(`/api/v1/categories/${l3}`, { parentId: l1 });
    expect(moved.status).toBe(422);
    expect(moved.body.error?.code).toBe('CATEGORY_LEVEL_INVALID');
  });

  it('filters products by category subtree (level-1 selects descendants)', async () => {
    const list = await client.get<Array<{ nameZh: string }>>(
      `/api/v1/products?categoryId=${l1}&pageSize=100`,
    );
    const names = list.body.data.map((product) => product.nameZh);
    expect(names).toContain(`${PREFIX} 挂三级商品`);
  });
});

describe('same-parent name uniqueness (decision 0005 #13)', () => {
  it('rejects duplicate names under one parent AND between roots', async () => {
    const first = await createCategory({ nameZh: `${PREFIX} 重名测试` });
    expect(first.status).toBe(201);

    const rootDup = await createCategory({ nameZh: `${PREFIX} 重名测试` });
    expect(rootDup.status).toBe(409);
    expect(rootDup.code).toBe('CATEGORY_NAME_DUPLICATED');

    const parent = await createCategory({ nameZh: `${PREFIX} 重名父级` });
    const childA = await createCategory({ parentId: parent.data.id, nameZh: '同名子级' });
    expect(childA.status).toBe(201);
    const childB = await createCategory({ parentId: parent.data.id, nameZh: '同名子级' });
    expect(childB.status).toBe(409);
    expect(childB.code).toBe('CATEGORY_NAME_DUPLICATED');
  });

  it('allows the same name under different parents', async () => {
    const parentA = await createCategory({ nameZh: `${PREFIX} 跨父A` });
    const parentB = await createCategory({ nameZh: `${PREFIX} 跨父B` });
    const a = await createCategory({ parentId: parentA.data.id, nameZh: `${PREFIX} 共享名` });
    const b = await createCategory({ parentId: parentB.data.id, nameZh: `${PREFIX} 共享名` });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });

  it('rejects renaming a category into a sibling name', async () => {
    const parent = await createCategory({ nameZh: `${PREFIX} 改名父级` });
    const a = await createCategory({ parentId: parent.data.id, nameZh: `${PREFIX} 改名甲` });
    const b = await createCategory({ parentId: parent.data.id, nameZh: `${PREFIX} 改名乙` });
    const renamed = await client.patch(`/api/v1/categories/${b.data.id}`, {
      nameZh: `${PREFIX} 改名甲`,
    });
    expect(renamed.status).toBe(409);
    void a;
  });
});

describe('brand naming (decision 0006)', () => {
  it('requires the general name; name_zh is optional', async () => {
    const missing = await client.post('/api/v1/brands', { nameZh: '只有中文名' });
    expect(missing.status).toBe(400);

    const created = await client.post<{ name: string; nameZh: string | null; nameEn: string | null }>(
      '/api/v1/brands',
      { name: `${PREFIX} Brand`, nameZh: `${PREFIX} 品牌中文名` },
    );
    expect(created.body.success).toBe(true);
    expect(created.body.data.name).toBe(`${PREFIX} Brand`);
    expect(created.body.data.nameZh).toBe(`${PREFIX} 品牌中文名`);
    expect(created.body.data.nameEn).toBeNull();

    const minimal = await client.post<{ name: string; nameZh: string | null }>(
      '/api/v1/brands',
      { name: `${PREFIX} Minimal` },
    );
    expect(minimal.body.success).toBe(true);
    expect(minimal.body.data.nameZh).toBeNull();
  });
});
