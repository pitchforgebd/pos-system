# আর্কিটেকচার v2

বর্তমান কাঠামো (Next.js 16 modular monolith + Prisma + MySQL + cPanel) রাখা হবে। মাইক্রোসার্ভিস বা নতুন স্ট্যাক নয়। বদলাবে **ভেতরের নকশা**: যে জায়গাগুলো থেকে অডিটের বাগ এসেছে, সেগুলো একটি করে কেন্দ্রীয় ইঞ্জিনে আনা হবে।

## ১. মূল নীতি

1. **এক সত্যের উৎস:** টাকার সব ব্যালান্স (ক্যাশ, ব্যাংক, কাস্টমার বাকি, Vendor বাকি, কুরিয়ার Condition, অগ্রিম) আসে `journal_lines` থেকে। স্টকের পরিমাণ আসে `stock_ledgers` থেকে (`stock_balances` শুধু দ্রুত পড়ার কপি)। আলাদা টেবিলে আলাদা হিসাব রাখা নিষেধ।
2. **এক পোস্টিং ইঞ্জিন:** প্রতিটি টাকা/স্টকের ঘটনা একটি `PostingPlan` বানায় → ইঞ্জিন একটি transaction-এ স্টক মুভমেন্ট + জার্নাল + অডিট লেখে → commit-এর আগে ইনভেরিয়েন্ট যাচাই করে।
3. **ব্যবসায়িক তারিখ:** প্রতিটি ডকুমেন্ট, জার্নাল ও স্টক লেজার সারিতে `businessDate` (DATE, Asia/Dhaka)। রিপোর্ট শুধু এটা দিয়ে ফিল্টার করে, `createdAt` দিয়ে নয়।
4. **ক্লায়েন্ট শুধু ইচ্ছা পাঠায়:** পরিমাণ, পণ্য, পেমেন্ট মেথড। দাম, মোট, VAT, cost সার্ভার হিসাব করে।
5. **নির্ভরযোগ্য সাবমিট:** প্রতিটি লেখার রিকোয়েস্ট idempotent; UI প্রচেষ্টা-প্রতি একটি key রাখে।

## ২. লেয়ার ও ফোল্ডার

```
src/
├── app/                     UI পেজ ও API রুট (পাতলা: শুধু defineRoute + সার্ভিস কল)
├── core/                    ← নতুন: সব মডিউলের ভাগ করা ইঞ্জিন
│   ├── http/define-route.ts       রুট র‍্যাপার (P01)
│   ├── tx/run.ts                  transaction runner: timeout, deadlock retry (P01)
│   ├── idempotency/               একটাই বাস্তবায়ন (P01)
│   ├── time/business-date.ts      Asia/Dhaka তারিখ, পিরিয়ড লক (P01)
│   ├── money/                     Decimal, রাউন্ডিং, ভাগ (allocation) (P01)
│   ├── accounts/roles.ts          accountFor(role) (P02)
│   ├── posting/                   PostingPlan → journal + stock + audit (P02/P03)
│   ├── stock/                     applyMovement, লট, গড় দাম (P03)
│   ├── parties/                   কাস্টমার/Vendor/কুরিয়ার সাবলেজার (P02)
│   └── reconcile/                 assertBooksReconcile, দৈনিক চেক (P02/P11)
├── modules/<feature>/       ফিচার-নির্দিষ্ট: schema (zod), service, read queries, tests
│   ├── catalog, pricing, purchasing, sales, orders, delivery,
│   ├── treasury (cash/bank/mobile), expenses, assets, shifts,
│   ├── customers, crm, sms, reports, access, settings
├── components/              UI; ফর্ম শুধু useSubmit দিয়ে
└── lib/                     ছোট হেল্পার (format, i18n, security headers)
```

নিয়ম: `modules/*` সরাসরি `journal`, `journal_lines`, `stock_ledgers`, `stock_balances`-এ লিখবে না; শুধু `core/posting` দিয়ে। একটি ESLint `no-restricted-imports`/টেস্ট এটা জোর করবে।

## ৩. পোস্টিং ইঞ্জিন

```ts
type PostingPlan = {
  docType: DocType;            // SALE, PURCHASE, RECEIPT, PAYMENT, EXPENSE, STOCK_ADJ, ...
  docId: string;
  businessDate: string;        // YYYY-MM-DD, Asia/Dhaka
  branchId: string;
  stock: StockMove[];          // product, variant, warehouse, qty, direction, type, unitCost?
  journal: JournalLineDraft[]; // role|accountId, debit|credit, partyId?, shiftId?, memo
  // stock-লাইনের cost ইঞ্জিন নিজে হিসাব করে journal-এ বসাতে পারে (costFromStock: true)
};

await post(tx, plan);  // ভেতরে ক্রমানুসারে:
// 1. পিরিয়ড লক চেক
// 2. stock moves প্রয়োগ (row lock, নেগেটিভ নিষেধ, গড় দাম, লট FEFO) → প্রকৃত cost ফেরত
// 3. cost-নির্ভর জার্নাল লাইন পূরণ
// 4. জার্নাল: Σdebit = Σcredit, অ্যাকাউন্ট সক্রিয়, পার্টি-অ্যাকাউন্টে partyId বাধ্যতামূলক
// 5. স্টক-জার্নাল মিল: এই ডকুমেন্টে 1400-এর নিট = স্টক মুভমেন্টের নিট মূল্য
// 6. audit row (একই tx)
```

ইনভেরিয়েন্ট ৫ থাকায় N2-এর মতো "স্টক বদলায় কিন্তু হিসাব বদলায় না" ভুল কোড লিখলেই টেস্টে ফেইল করবে।

## ৪. Transaction runner

`runTx(fn, { timeoutMs: 20000, maxWaitMs: 5000, retries: 3 })`

- MySQL deadlock (1213) / Prisma `P2034` / idempotency race হলে exponential backoff-এ আবার চালায়।
- লক ক্রম নির্দিষ্ট: document_sequence → party (customer/vendor) → stock_balances (productId, warehouseId ক্রমে) → serial। সবাই একই ক্রমে লক নেয় বলে deadlock কম।
- নতুন stock row: `INSERT ... ON DUPLICATE KEY UPDATE` তারপর `FOR UPDATE` (N21)।

## ৫. রুট র‍্যাপার

```ts
export const POST = defineRoute({
  permission: "sales.create",
  body: SaleInput,                // zod; তারিখ = isoDate (বৈধ ক্যালেন্ডার তারিখ)
  idempotent: true,               // Idempotency-Key বাধ্যতামূলক
  audit: { action: "sale", module: "sales" },
  handler: (ctx, input, tx) => postSale(ctx, input, tx),
});
```

`route-guard.test.ts` যাচাই করবে প্রতিটি `route.ts` `defineRoute` বা অনুমোদিত পাবলিক তালিকায় আছে।

## ৬. ক্লায়েন্ট

- `useSubmit(url, { idempotent: true })` → `{ submit, pending, error }`। key প্রচেষ্টা-প্রতি স্থির; `crypto.randomUUID` না থাকলে `getRandomValues` fallback (N23)।
- সার্ভার-সাইড সার্চ (`/api/v1/search/products?q=`, `/customers?q=`), debounce ২০০ms, ২০টি ফল (N8)।
- টাকা `৳` ও বাংলা/ইংরেজি অংক সেটিং অনুযায়ী (P13)।

## ৭. অর্ডার ও ডকুমেন্ট জীবনচক্র

```
Sales Order:  DRAFT → CONFIRMED → PACKED → DISPATCHED → DELIVERED
                  ↘ CANCELLED (DISPATCHED-এর আগে)      ↘ RETURNED (আংশিক/পূর্ণ)
POS বিক্রি:   একবারে DRAFT→DELIVERED (একই transaction)
Purchase:     DRAFT → ORDERED → RECEIVED (স্টক + বিল পোস্ট)
```

- CONFIRMED হলে স্টক **রিজার্ভ** (`stock_reservations`); available = onHand − reserved।
- DISPATCHED হলে ইনভয়েস পোস্ট: স্টক কমে, রাজস্ব ও COGS স্বীকৃত (সিদ্ধান্ত D4)।
- পেমেন্ট স্ট্যাটাস আলাদা ও হিসাবকৃত: `UNPAID | PARTIAL | PAID` = ইনভয়েস মোট বনাম `payment_allocations`।

## ৮. পারফরম্যান্স নীতি

- তালিকা: সার্ভার-সাইড পেজিনেশন (কার্সর/অফসেট), ফিল্টার SQL-এ।
- রিপোর্ট: জার্নাল/লেজার থেকে SQL aggregate; দিন শেষে `daily_snapshots` (ক্যাশ, ব্যাংক, স্টক মূল্য, বাকি) জমা — পুরনো দিনের রিপোর্ট দ্রুত।
- ড্যাশবোর্ড: একটি combined query + ৩০ সেকেন্ড ক্যাশ।
- সেশন: প্রতি রিকোয়েস্টে একবার লোড (request-scoped cache), idle timeout ৩০ মিনিট (সেটিং)।
