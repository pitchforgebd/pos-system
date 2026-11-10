# P03 — ইনভেন্টরি ইঞ্জিন v2

**লক্ষ্য:** স্টক = হিসাব। প্রতিটি স্টক ডকুমেন্ট জার্নাল দেয় (N2), ইনভেন্টরির মূল্য এক জায়গা থেকে (N11), লট গুদাম-ভিত্তিক (N14), cost ৪ দশমিক (N13), Take-off ফিচার, লো-স্টক অ্যালার্ট।
**পূর্বশর্ত:** P02। **সিদ্ধান্ত:** D1, D5। **পড়ুন:** `02` #1–#10, #16; `03` §৪; `04` ফিচার ১, ২, ৮।

## টাস্ক

1. **মাইগ্রেশন** `03` §৪: stock_ledgers (`businessDate`, `unitCost` 18,4, `totalCost`, `branchId`), `reservedQty`, expiry_batches-এ warehouse + unique, `stock_reservations`, product_serials (warehouse, variant, enum status), `stock_documents`, `TAKE_OFF` টাইপ। পুরনো opening/own/adjust/damage টেবিলের ডাটা `stock_documents`-এ আনা।
2. **`core/stock`:** `applyMovement` এখানে; নতুন row `INSERT … ON DUPLICATE KEY` + `FOR UPDATE` (N21); নেগেটিভ নিষেধ (D5); avg cost; লট FEFO upsert (warehouse ধরে); cost ফেরত দেয়।
3. **পোস্টিং ইঞ্জিনে স্টক অংশ যোগ:** `post()` স্টক মুভ প্রয়োগ → cost → জার্নাল পূরণ → **I3** (1400 নিট = মুভমেন্ট মূল্য)। `costFromStock` লাইন।
4. **প্রতিটি স্টক ডকুমেন্ট নতুন ইঞ্জিনে** (`02` #1–#10): Opening (3900), Own stock (3100), Adjustment ± (4300/5200), Damage, Expiry (5200), Take-off (D1: উদ্দেশ্য → খাত/Drawings), Transfer (ব্রাঞ্চ ডাইমেনশন)। CSV opening import একই পথে।
5. **Supplier return PPV** (N11, #16): পার্থক্য 5300-এ। (ক্রয় নিজে P05-এ, কিন্তু রিটার্নের হিসাব এখানেই ঠিক।)
6. **ভ্যালুয়েশন:** স্টক তালিকা/সামারি/রিপোর্ট `averageCost` থেকে; `purchasePrice` দিয়ে মূল্য দেখানো বন্ধ।
7. **IMEI/serial** (N4, L8, I13): শুধু স্টক-ইনে (ক্রয়/opening) যোগ; বিক্রিতে `updateMany(status IN_STOCK)` count=1; warehouse মিল।
8. **Take-off ফিচার** (ফিচার ৮): ফর্ম (তারিখ, পণ্য, পরিমাণ, লট, উদ্দেশ্য, প্রাপক, অনুমোদনকারী, নোট), তালিকা, প্রিন্ট। পারমিশন `inventory.takeoff`।
9. **লো-স্টক অ্যালার্ট** (ফিচার ২, N18): SQL ফিল্টার + পেজিনেশন, সাইডবার ব্যাজ, রিঅর্ডার তালিকা (শেষ Vendor, শেষ দাম, ৩০ দিনের গড় বিক্রি, প্রস্তাবিত পরিমাণ), মেয়াদ সতর্কতা ৩০/৬০/৯০।
10. **`/inventory` হাব পেজ** (H10 আংশিক), ট্রান্সফার তালিকা (U12)।
11. **B14:** `ledgerMatchesBalance` SQL aggregate। **L7:** `trackBatch` — `trackExpiry` থাকলে ব্যাচ বাধ্যতামূলক, আলাদা ফ্ল্যাগ সরানো (মালিককে জানিয়ে)।
12. **ডাটা ব্যাকফিল:** বিদ্যমান স্টকের জন্য একটি "v2 opening সমন্বয়" জার্নাল যাতে GL 1400 = Σ qty × avg হয় (শুধু staging/লোকাল; লাইভ নতুন DB — D16)।

## টেস্ট

- প্রতিটি ডকুমেন্ট টাইপ: স্টক + জার্নাল + I3 + `assertBooksReconcile`
- opening → সেল → damage → take-off → adjustment → GL 1400 = Σ qty × avg
- supplier return ভিন্ন দামে → PPV লাইন, 1400 মিলে
- দুই গুদামে লট: গুদাম-A বিক্রি গুদাম-B-র লট ছোঁয় না
- নতুন পণ্যের প্রথম স্টক-ইন সমান্তরাল ২টি → দুটোই সফল, ব্যালান্স ঠিক
- একই IMEI সমান্তরাল দুই বিক্রি → একটি সফল
- ৫০০ এলোমেলো স্টক অপারেশনের ফাজ টেস্ট → সব ইনভেরিয়েন্ট সত্য

## DoD

- [x] `documents.ts`-এ সরাসরি স্টক/জার্নাল লেখা নেই; সব `post()` দিয়ে (I18 স্ট্যাটিক টেস্ট) — `src/modules/inventory/static-rules.test.ts` সবুজ; সব ডকুমেন্ট `postWithStock` দিয়ে
- [x] staging-এ রিকনসিলিয়েশন: GL 1400 = স্টক মূল্য ✔ — P14-এর আগে staging নেই, তাই লোকাল `meridian_practice`-এ: `scripts/stock-books.ts repair` ("v2 opening adjustment") এর পরে `scripts/reconcile.ts` ০ finding, ০ warning (I6 সহ, কঠোর); প্রোডাকশন বিল্ডে take-off বানানোর পরেও একই
- [x] লো-স্টক ও Take-off স্ক্রিন কাজ করে — প্রোডাকশন বিল্ডে `/inventory`, `/inventory/alerts` (SQL ফিল্টার, পেজিনেশন, রিঅর্ডার তালিকা, মেয়াদ সতর্কতা, সাইডবার ব্যাজ), `/inventory/take-off` (ফর্ম→201, তালিকা, প্রিন্ট স্লিপ, বেশি পরিমাণে 422), `/inventory/transfers` যাচাই; সার্ভার লগ পরিষ্কার
- [x] typecheck, lint, test সবুজ; কমিট `v2(P03)` — ২৯৬/২৯৬ খালি `meridian_ci` ও dev ডাটাবেসে; ৫০০-অপারেশনের ফাজ টেস্টসহ
