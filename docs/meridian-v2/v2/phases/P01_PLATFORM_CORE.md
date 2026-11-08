# P01 — প্ল্যাটফর্ম কোর

**লক্ষ্য:** যে ভিত্তির উপর প্রতিটি ফিচার দাঁড়াবে: ব্যবসায়িক তারিখ, রুট র‍্যাপার, একক idempotency, transaction runner, পিরিয়ড লক, নির্ভরযোগ্য ফর্ম সাবমিট। ব্যবসার নিয়ম এই ফেজে বদলাবে না — শুধু বিদ্যমান রুট/ফর্ম নতুন ভিত্তিতে আনা।
**পূর্বশর্ত:** P00। **সিদ্ধান্ত লাগবে:** D9, D10, D18। **পড়ুন:** `01_ARCHITECTURE.md` §৪–৬।

## টাস্ক

1. **`src/core/time`** (N17, U6, B4, B4b)
   - `businessDate(now?, tz="Asia/Dhaka")` → `YYYY-MM-DD`; `fiscalYear(date)` (D9); `isoDate` zod স্কিমা (বৈধ ক্যালেন্ডার তারিখ, `2026-02-31` বাতিল → 400, 500 নয়)।
   - ইউনিট টেস্ট: ঢাকা রাত ০০:৩০ = নতুন দিন; UTC ১৮:৩০ = পরের দিন; লিপ ইয়ার।
2. **মাইগ্রেশন:** `03_DATA_MODEL.md` §১–২ (`occurredOn` → `businessDate` নাম বদল, org-এ timezone/fiscal/lock কলাম, ইন্ডেক্স)। কোডে সব `occurredOn` রেফারেন্স একসাথে বদল।
3. **পিরিয়ড লক** (N9, I11): `assertPostable(ctx, date)` — `lockedThrough`-এর পরে, আজকের (ঢাকা) পরে নয়, পেছনে `backdateDays`-এর বেশি হলে `posting.backdate` পারমিশন। নতুন পারমিশন সিড।
4. **`src/core/money`:** Decimal হেল্পার, half-up রাউন্ড, `allocate(total, weights)` (largest-remainder), `parseMoney` স্ট্রিং-only। সব মডিউলের কপি (`money()`, `zero()`) এখানে আনা।
5. **`src/core/tx/run.ts`** (N6, N21): timeout ২০s, maxWait ৫s, deadlock/P2034/P2002-idempotency-তে ৩ বার রিট্রাই, লক-ক্রম হেল্পার। টেস্ট: কৃত্রিম deadlock-এ রিট্রাই সফল।
6. **`src/core/idempotency`** (H3, B3, N24): একটিমাত্র বাস্তবায়ন — key + payload hash; replay পূর্ণ মূল রেসপন্স (নম্বর, মোট সহ) ফেরত; ভিন্ন payload 409। `books.ts`, `shifts.ts`, `extras.ts` সহ সব কপি মুছে এটায় আনা।
7. **`src/core/http/define-route.ts`** (S8, N22, I17): CSRF → সেশন → পারমিশন → branch → zod → idempotency → `runTx` → audit (একই tx) → envelope। সেশন request-এ একবার লোড (N20 আংশিক)।
   - ১১০টি রুট ধাপে ধাপে `defineRoute`-এ আনা (মডিউল অনুযায়ী ব্যাচে, প্রতি ব্যাচে টেস্ট)।
   - `route-guard.test.ts` হালনাগাদ: প্রতিটি `route.ts` `defineRoute` বা পাবলিক-তালিকায়।
8. **`useSubmit` হুক** (N1, N23, U7, U8, L13): প্রচেষ্টা-প্রতি স্থির key, UUID fallback, নেটওয়ার্ক এরর বাংলা বার্তা, ডাবল-ক্লিক লক, সাফল্যের টোস্ট, সফলে router refresh (পুরো পেজ রিলোড নয়)। ফর্ম প্যাটার্ন: react-hook-form + zod (একই স্কিমা সার্ভার-ক্লায়েন্ট)।
   - ৭টি ফর্ম আগে (POS, রিটার্ন, ক্রয়, ডিউ কালেকশন, শিফট, অ্যাকাউন্টিং, ইমপোর্ট), তারপর বাকি সব।
   - স্ট্যাটিক টেস্ট: কোনো কম্পোনেন্টে সরাসরি `crypto.randomUUID()` বা idempotency হেডার হাতে বসানো নেই।
9. **শেয়ার্ড পেজিনেশন** (B11, LV-3): `listQuery({ page, pageSize, sort })` + `Pagination` কম্পোনেন্ট; ডিফল্ট সাজানো `businessDate desc, number desc`।
10. **ডকুমেন্ট নম্বর** (D10, I12): ধরন + অর্থবছর; বিদ্যমান allocator বজায়, ফরম্যাট বদল।
11. **N21 — stock row ও টেস্টের deadlock ঠিক করা এবং টেস্টের সমান্তরালতা ফিরিয়ে আনা** (task 5-এর `runTx` তৈরির পরে করবে)
    - **পটভূমি:** P00-এ `npm test` সাময়িকভাবে `--test-concurrency=1`-এ চলছে, কারণ সমান্তরাল রানে মাঝে মাঝে "write conflict or a deadlock" (Prisma P2034) ব্যর্থতা আসে: `stockBalance.create`-এ (`inventory.test.ts`, import ও damage-expiry টেস্টে) এবং ক্লিনআপের `journalLine.deleteMany`-এ। খালি DB-তে ১৬টি সমান্তরাল রানের ৫টিতে, প্রতিবার ভিন্ন টেস্টে। InnoDB-র deadlock রেকর্ডে ধরা পড়া দুই পক্ষ: এক টেস্টের ক্লিনআপ `DELETE FROM journal_lines WHERE organizationId=…` বনাম অন্য টেস্টের `INSERT INTO journal_lines` (`REPEATABLE-READ`, ছোট টেবিলে `PRIMARY` স্ক্যান)। **অপ্রমাণিত:** `stock_balances`-এর deadlock প্রোডাক্ট কোডের নিজস্ব race (দুজন একসাথে নতুন (পণ্য, গুদাম) row বানানো) নাকি টেস্ট-বনাম-টেস্ট সংঘর্ষ; ওটার দুই পক্ষ ধরা যায়নি। ধাপ ১ এটা নির্ধারণ করবে। `--test-concurrency=1` শুধু লক্ষণ ঢাকে।
    - **ধাপ ১ — আগে ব্যর্থ টেস্ট, দুই ভাগে:** (ক) একটিমাত্র টেস্ট ফাইলের ভেতরে P00 হারনেসের `concurrently(10, …)` দিয়ে একই নতুন (পণ্য, গুদাম) key-তে ১০টি সমান্তরাল stock-in; অন্য ফাইলের ক্লিনআপ নেই, তাই এটা শুধু প্রোডাক্ট race দেখায়। (খ) `--test-concurrency=1` ছাড়া পূর্ণ স্যুট বারবার (ফাইলে-ফাইলে সংঘর্ষ)। কোনটা ব্যর্থ হয় তা **দেখিয়ে** নির্ধারণ করো: (ক) ব্যর্থ হলে প্রোডাক্ট বাগ (ধাপ ২); শুধু (খ) ব্যর্থ হলে টেস্ট-পরিবেশের সমস্যা (ধাপ ৪ক)।
    - **ধাপ ২ — ফিক্স (শুধু (ক) ব্যর্থ হলে):** `applyMovement`-এ নতুন row `INSERT … ON DUPLICATE KEY UPDATE` (no-op আপডেট), তারপর `SELECT … FOR UPDATE` (`01_ARCHITECTURE.md` §৪); পুরো পোস্টিং `runTx`-এর ভেতরে, যাতে deadlock (1213)/P2034-এ backoff-সহ রিট্রাই হয়; লক-ক্রম (productId, warehouseId) অনুযায়ী।
    - **ধাপ ৩ — যাচাই:** ১০টি সমান্তরাল নতুন-row সবগুলো সফল; `stock_balances.quantity` = Σ `stock_ledgers`; ডুপ্লিকেট row বা ব্যর্থতা নেই।
    - **ধাপ ৪ক — টেস্ট-পরিবেশ:** হারনেসের ক্লিনআপ deadlock-মুক্ত করো (যেমন org-ভিত্তিক মোছা ইন্ডেক্স ধরে ছোট ব্যাচে, বা টেস্ট সেশনে `READ COMMITTED`); নইলে সমান্তরালতা ফেরালে (খ) আবার ব্যর্থ হবে।
    - **ধাপ ৪ — concurrency ফেরানো:** `package.json`-এর `test` স্ক্রিপ্ট থেকে `--test-concurrency=1` সরাও; খালি DB-তে (শুধু migrate, সিড নয়) পূর্ণ স্যুট সমান্তরালে টানা ২০ বার সবুজ — ২০ রানের ফল দেখাও।

## টেস্ট (বাধ্যতামূলক)

- একই key দুইবার POST → একটি সেল, দ্বিতীয় রেসপন্সে একই নম্বর
- একই key ভিন্ন body → 409
- ১০টি সমান্তরাল একই-key → একটি সেল
- অবৈধ তারিখ → 400; লকড তারিখ → 422; ভবিষ্যৎ তারিখ → 422
- audit সারি ও ডকুমেন্ট একই tx-এ (audit ব্যর্থ হলে পুরো rollback)

## DoD

- [x] সব mutating রুট `defineRoute`-এ; route-guard টেস্ট সবুজ — ১১০টি `route.ts` ফাইলের সবগুলো, ১৫০টি HTTP হ্যান্ডলারের সবগুলো
- [x] সব টাকা/স্টকের ফর্ম `useSubmit`-এ; স্ট্যাটিক টেস্ট সবুজ — `src/lib/client/static-rules.test.ts`; শুধু তিনটি পাবলিক সাইন-ইন পেজ নিজের fetch রাখে (তালিকা ছোট হতেই পারে, বাড়ে না)
- [x] কোডে `toISOString().slice(0, 10)` শূন্য (grep প্রমাণ) — grep ফল ০; স্ট্যাটিক টেস্ট `core/time/static-rules.test.ts`
- [x] idempotency বাস্তবায়ন একটিই (grep প্রমাণ) — `idempotency_keys` টেবিল শুধু `src/core/idempotency` ছোঁয়; বাইরে ০
- [x] N21: কারণ নির্ধারিত (টাস্ক ১১-র ধাপ ১) ও ঠিক (ধাপ ২ বা ৪ক) প্রমাণসহ; `--test-concurrency=1` সরানো; খালি DB-তে পূর্ণ স্যুট সমান্তরালে টানা ২০ বার সবুজ — দুটোই ছিল: (ক) প্রোডাক্ট race (১২ রানের ১২টিতে ব্যর্থ → `INSERT … ON DUPLICATE KEY UPDATE`), (খ) টেস্টের সংঘর্ষ (৬ রানের ২টিতে ব্যর্থ → হারনেসের কাটালগ ও `cleanupOrg`)। ফল: খালি DB-তে টানা ২০/২০ সবুজ (১৫৫টি টেস্ট), ছোট পুল (৩) ও ৩ ফাইল একসাথে ৫/৫ সবুজ
- [ ] staging-এ ব্রাউজারে: নেট বন্ধ করে POS সাবমিট → বার্তা আসে → নেট চালু করে আবার → একটিই সেল — আসল ক্লায়েন্ট কোড + প্রোডাকশন বিল্ডে HTTP-স্তরে সিমুলেশন ✔ (উত্তর হারালে বাংলা বার্তা, দ্বিতীয় ট্যাপ "busy", আবার চাপলে একই নম্বরে replay, সেল ১টিই); **আসল ব্রাউজারে ক্লিক-পরীক্ষা মালিকের বাকি** (practice সাইট `http://127.0.0.1:3100`, DevTools → Network → Offline)
- [x] typecheck, lint, test সবুজ; কমিট `v2(P01)`
