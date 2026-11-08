import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../../lib/db/client.ts";
import { listPurchases, purchaseSorts } from "../../modules/purchasing/purchases.ts";
import { listSales, saleSorts } from "../../modules/sales/sales.ts";
import { factories, withTestOrg } from "../../tests/helpers/index.ts";
import { documentSorts, listQuery, pageHref, pageInfo, reverseOrder } from "./index.ts";

const sorts = documentSorts({ number: "asc" });

test("a list reads page, pageSize and sort from the request and clamps anything odd", () => {
  assert.deepEqual(
    (({ page, pageSize, skip, take, sort }) => ({ page, pageSize, skip, take, sort }))(listQuery({}, { sorts })),
    { page: 1, pageSize: 25, skip: 0, take: 25, sort: "-date" },
  );
  const third = listQuery({ page: "3", pageSize: "10" }, { sorts });
  assert.equal(third.skip, 20);
  assert.equal(third.take, 10);
  // text, zero, negative, fractions and absurd sizes all fall back or clamp
  assert.equal(listQuery({ page: "abc" }, { sorts }).page, 1);
  assert.equal(listQuery({ page: "0" }, { sorts }).page, 1);
  assert.equal(listQuery({ page: "-4" }, { sorts }).page, 1);
  assert.equal(listQuery({ page: "2.5" }, { sorts }).page, 1);
  assert.equal(listQuery({ pageSize: "100000" }, { sorts }).pageSize, 100);
  assert.equal(listQuery({ pageSize: "0" }, { sorts }).pageSize, 1);
  assert.equal(listQuery({ pageSize: "999999999999" }, { sorts }).pageSize, 25);
  // a repeated parameter (?page=2&page=3) uses the first, and numbers work as well as strings
  assert.equal(listQuery({ page: ["2", "3"] }, { sorts }).page, 2);
  assert.equal(listQuery({ page: 4, pageSize: 5 }, { sorts }).skip, 15);
  assert.equal(listQuery({ pageSize: "500" }, { sorts, maxPageSize: 200 }).pageSize, 200);
  assert.equal(listQuery({}, { sorts, defaultPageSize: 50 }).pageSize, 50);
});

test("a list sorts only by a name it allows, newest first by default (businessDate desc, number desc)", () => {
  assert.deepEqual(listQuery({}, { sorts }).orderBy, [{ businessDate: "desc" }, { number: "desc" }, { id: "desc" }]);
  assert.deepEqual(listQuery({ sort: "date" }, { sorts }).orderBy, [{ businessDate: "asc" }, { number: "asc" }, { id: "asc" }]);
  assert.deepEqual(listQuery({ sort: "-number" }, { sorts }).orderBy, [{ number: "desc" }, { businessDate: "desc" }, { id: "desc" }]);
  // unknown names, injection attempts and prototype keys fall back to the default
  for (const sort of ["password", "-passwordHash", "date; DROP TABLE sales", "__proto__", "constructor", "-constructor", "", "--date"]) {
    assert.deepEqual(listQuery({ sort }, { sorts }).orderBy, listQuery({}, { sorts }).orderBy, `sort=${sort}`);
    assert.equal(listQuery({ sort }, { sorts }).sort, "-date");
  }
  assert.throws(() => listQuery({}, { sorts, defaultSort: "nope" }), /default sort/);
});

test("reverseOrder flips nested directions too", () => {
  assert.deepEqual(reverseOrder([{ invoice: { number: "asc" } }, { id: "desc" }]), [{ invoice: { number: "desc" } }, { id: "asc" }]);
});

test("pageInfo gives the pager its numbers, including the empty list and a page past the end", () => {
  const query = (page: number) => listQuery({ page: String(page), pageSize: "10" }, { sorts });
  assert.deepEqual(pageInfo(23, query(1)), { page: 1, pageSize: 10, total: 23, pageCount: 3, sort: "-date", from: 1, to: 10, hasPrevious: false, hasNext: true });
  assert.deepEqual(pageInfo(23, query(3)), { page: 3, pageSize: 10, total: 23, pageCount: 3, sort: "-date", from: 21, to: 23, hasPrevious: true, hasNext: false });
  const empty = pageInfo(0, query(1));
  assert.deepEqual([empty.pageCount, empty.from, empty.to, empty.hasNext, empty.hasPrevious], [1, 0, 0, false, false]);
  const past = pageInfo(23, query(9));
  assert.deepEqual([past.from, past.to, past.hasNext, past.hasPrevious], [0, 0, false, true]);
});

test("pageHref keeps the other parameters, drops empty ones, and leaves page 1 out of the link", () => {
  assert.equal(pageHref("/sales", { q: "rice", sort: undefined, pageSize: 50 }, 3), "/sales?q=rice&pageSize=50&page=3");
  assert.equal(pageHref("/sales", { page: "7" }, 1), "/sales");
  assert.equal(pageHref("/sales", { q: ["a", "b"] }, 2), "/sales?q=a&page=2");
});

// ---- real lists, real database

function saleRow(t: { org: { id: string }; branch: { id: string } }, date: string, number: string) {
  return prisma.sale.create({
    data: {
      organizationId: t.org.id,
      branchId: t.branch.id,
      status: "POSTED",
      total: "10.00",
      businessDate: new Date(`${date}T00:00:00.000Z`),
      invoice: { create: { organizationId: t.org.id, branchId: t.branch.id, number, total: "10.00" } },
    },
  });
}

test("the sales list pages newest first by date then invoice number, with no row repeated or skipped", async () => {
  await withTestOrg(async (t) => {
    const made = [
      ["2026-10-01", "INV-2627-000001"],
      ["2026-10-01", "INV-2627-000002"],
      ["2026-10-03", "INV-2627-000005"],
      ["2026-10-02", "INV-2627-000003"],
      ["2026-10-03", "INV-2627-000004"],
      ["2026-10-02", "INV-2627-000006"], // an older number on a newer date still sorts by date first
      ["2026-09-30", "INV-2627-000007"],
    ] as const;
    for (const [date, number] of made) {
      await saleRow(t, date, number);
    }
    const expected = ["INV-2627-000005", "INV-2627-000004", "INV-2627-000006", "INV-2627-000003", "INV-2627-000002", "INV-2627-000001", "INV-2627-000007"];

    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const result = await listSales(t.org.id, t.branch.id, listQuery({ page, pageSize: 3 }, { sorts: saleSorts }));
      assert.equal(result.page.total, 7);
      assert.equal(result.page.pageCount, 3);
      assert.equal(result.rows.length, page === 3 ? 1 : 3);
      assert.equal(result.page.hasNext, page < 3);
      seen.push(...result.rows.map((row) => row.number ?? ""));
    }
    assert.deepEqual(seen, expected, "the three pages together are the whole list in order");

    const past = await listSales(t.org.id, t.branch.id, listQuery({ page: 9, pageSize: 3 }, { sorts: saleSorts }));
    assert.deepEqual([past.rows.length, past.page.total, past.page.from], [0, 7, 0]);

    const byNumber = await listSales(t.org.id, t.branch.id, listQuery({ sort: "number", pageSize: 100 }, { sorts: saleSorts }));
    assert.deepEqual(byNumber.rows.map((row) => row.number), [...expected].sort());
  });
});

test("a list never shows another branch's or organization's rows, and the default call still returns the first page", async () => {
  await withTestOrg(async (t) => {
    await saleRow(t, "2026-10-01", "INV-2627-000001");
    const other = await prisma.branch.create({ data: { organizationId: t.org.id, name: "Elsewhere" } });
    await saleRow({ org: t.org, branch: other }, "2026-10-02", "INV-2627-000002");
    const result = await listSales(t.org.id, t.branch.id);
    assert.deepEqual(result.rows.map((row) => row.number), ["INV-2627-000001"]);
    assert.equal(result.page.total, 1);
  });
});

test("the purchases list pages the same way, and its search runs in SQL across all pages", async () => {
  await withTestOrg(async (t) => {
    const f = factories(t);
    const rice = await f.vendor({ name: "Rice Traders" });
    const salt = await f.vendor({ name: "Salt Supply" });
    for (let n = 1; n <= 30; n += 1) {
      await prisma.purchase.create({
        data: {
          organizationId: t.org.id,
          branchId: t.branch.id,
          supplierId: n % 10 === 0 ? rice.id : salt.id,
          number: `PUR-2627-${String(n).padStart(6, "0")}`,
          status: "POSTED",
          total: "5.00",
          businessDate: new Date(`2026-10-${String(1 + Math.floor((n - 1) / 3)).padStart(2, "0")}T00:00:00.000Z`),
        },
      });
    }
    const first = await listPurchases(t.org.id, t.branch.id, listQuery({ pageSize: 10 }, { sorts: purchaseSorts }));
    assert.equal(first.page.total, 30);
    assert.equal(first.rows.length, 10);
    assert.equal(first.rows[0].number, "PUR-2627-000030", "newest date, highest number first");

    // 'Rice' is on 3 purchases (10, 20, 30) that are spread over several pages of the full list
    const rice1 = await listPurchases(t.org.id, t.branch.id, listQuery({ pageSize: 2 }, { sorts: purchaseSorts }), "rice");
    assert.equal(rice1.page.total, 3);
    assert.deepEqual(rice1.rows.map((row) => row.number), ["PUR-2627-000030", "PUR-2627-000020"]);
    const rice2 = await listPurchases(t.org.id, t.branch.id, listQuery({ page: 2, pageSize: 2 }, { sorts: purchaseSorts }), "rice");
    assert.deepEqual(rice2.rows.map((row) => row.number), ["PUR-2627-000010"]);
    const byNumber = await listPurchases(t.org.id, t.branch.id, listQuery({ pageSize: 100 }, { sorts: purchaseSorts }), "000007");
    assert.deepEqual(byNumber.rows.map((row) => row.number), ["PUR-2627-000007"]);
  });
});

test("GET /api/v1/sales pages with ?page= & pageSize= & sort=, keeps data an array, puts the page in meta, and shrugs off hostile values", async () => {
  const { GET } = await import("../../app/api/v1/sales/route.ts");
  const { openSession } = await import("../../modules/auth/session.ts");
  await withTestOrg(async (t) => {
    for (let n = 1; n <= 5; n += 1) {
      await saleRow(t, `2026-10-0${n}`, `INV-2627-00000${n}`);
    }
    const { token } = await openSession({ organizationId: t.org.id, userId: t.owner.id, branchId: t.branch.id, ip: "127.0.0.1", userAgent: "test" });
    const get = async (query: string) => {
      const response = await GET(new Request(`http://localhost/api/v1/sales${query}`, { headers: { cookie: `meridian_session=${token}` } }), { params: Promise.resolve({}) });
      return { status: response.status, body: (await response.json()) as { data: { number: string }[]; meta: { page: { page: number; pageSize: number; total: number; pageCount: number; hasNext: boolean } } } };
    };
    const second = await get("?page=2&pageSize=2");
    assert.equal(second.status, 200);
    assert.ok(Array.isArray(second.body.data), "data is still the array of rows");
    assert.deepEqual(second.body.data.map((row) => row.number), ["INV-2627-000003", "INV-2627-000002"]);
    assert.deepEqual([second.body.meta.page.page, second.body.meta.page.pageSize, second.body.meta.page.total, second.body.meta.page.pageCount, second.body.meta.page.hasNext], [2, 2, 5, 3, true]);
    const ascending = await get("?sort=date&pageSize=2");
    assert.deepEqual(ascending.body.data.map((row) => row.number), ["INV-2627-000001", "INV-2627-000002"]);
    for (const hostile of ["?page=abc&pageSize=-1&sort=passwordHash", "?page=99999999999999&pageSize=1e9", "?sort=date;DROP TABLE sales", "?page[]=2&sort[]=x"]) {
      const answer = await get(hostile);
      assert.equal(answer.status, 200, hostile);
      assert.ok(answer.body.meta.page.pageSize >= 1 && answer.body.meta.page.pageSize <= 100, hostile);
    }
    assert.equal(await prisma.sale.count({ where: { organizationId: t.org.id } }), 5, "nothing was changed by the hostile requests");
  });
});
