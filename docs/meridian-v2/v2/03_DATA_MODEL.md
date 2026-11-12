# ডাটা মডেল v2

বর্তমান Prisma স্কিমা (১০০ model) ভিত্তি। নিচে শুধু **পরিবর্তন**। প্রতিটি পরিবর্তন যে ফেজে আসবে তা লেখা আছে। লাইভে আসল ডাটা নেই (শুধু ডেমো), তাই D16 অনুযায়ী লাইভে যাওয়ার আগে DB নতুন করে তৈরি হবে; তবু প্রতিটি migration এমনভাবে লিখতে হবে যাতে বিদ্যমান ডাটায় চলে (ব্যাকফিলসহ)।

## ১. সব টাকা/স্টক ডকুমেন্টে সাধারণ কলাম (P01)

```
businessDate  DATE NOT NULL          -- Asia/Dhaka ব্যবসায়িক তারিখ
branchId      FK NOT NULL
createdBy     FK users
postedAt      DATETIME NULL
status        enum (ডকুমেন্ট অনুযায়ী)
reference     VARCHAR(64) NULL       -- বাইরের রেফারেন্স (অর্ডার রেফ, চালান নং)
note          VARCHAR(500) NULL
```

বিদ্যমান `occurredOn` থাকলে তার নাম `businessDate`-এ বদলাবে (এক migration-এ, কোডসহ)।

## ২. প্ল্যাটফর্ম (P01)

| টেবিল/কলাম | উদ্দেশ্য |
| --- | --- |
| `organizations.timezone` (ডিফল্ট `Asia/Dhaka`), `fiscalYearStartMonth` (৭), `lockedThrough` DATE NULL, `backdateDays` (৩) | তারিখ ও পিরিয়ড লক (N9) |
| `idempotency_keys` + `@@index([createdAt])` | পরিষ্কারের জব (D5) |
| `sessions` + `lastSeenAt`, `@@index([expiresAt])` | idle timeout (N20, D5) |
| `audit_logs` + `@@index([action, ip, createdAt])` | লগইন লিমিট (N19) |
| `rate_limits` (key, windowStart, count) | DB-ভিত্তিক রেট লিমিট (H15, S6) |

## ৩. লেজার কোর (P02)

| টেবিল/কলাম | উদ্দেশ্য |
| --- | --- |
| `accounts` + `isSystem` BOOL, `kind` enum(CASH, BANK, MOBILE, OTHER), `accountNumber`, `bankName`, `bankBranch` | ব্যাংক/মোবাইল অ্যাকাউন্ট আলাদা অ্যাকাউন্ট হিসেবে |
| `account_roles` (organizationId, role, accountId) unique(org, role) | হার্ডকোড কোড বাদ (B8) |
| `journals` + `businessDate`, `docType`, `docId`, `@@unique([docType, docId, kind])` | এক ডকুমেন্টে এক জার্নাল (reversal আলাদা kind) |
| `journal_lines` + `partyType` enum(CUSTOMER, VENDOR, COURIER, EMPLOYEE) NULL, `partyId` NULL, `shiftId` NULL, `branchId`, `businessDate` (denormalized), `assetId` NULL (FK P09-এ, `fixed_assets` আসার পর) | সাবলেজার ও রিপোর্টের ডাইমেনশন। DB CHECK: লাইন হয় debit নয় credit, > 0 (I1) |
| ইন্ডেক্স: `journal_lines(organizationId, accountId, businessDate)`, `(organizationId, partyType, partyId, businessDate)`, `(shiftId)` | রিপোর্ট দ্রুত |
| `customer_ledgers`, `supplier_ledgers` | **বাদ** — জার্নালের party লাইন থেকে view/query। **অবস্থা (P02 টাস্ক ৬):** কোডে এই দুই টেবিলে আর কিছু লেখা বা পড়া হয় না (শুধু `scripts/party-ledgers.ts` যাচাইয়ের জন্য পড়ে); পুরনো ডাটা `scripts/party-ledgers.ts repair` দিয়ে জার্নালে আনা ও মেলানো হয়েছে। টেবিল দুটি `drop` করার migration মালিকের অনুমতির অপেক্ষায় (dev ডাটাবেসের ডাটা মুছে যায়), তাই এখনো লেখা হয়নি |
| `payment_allocations` (journalId = রসিদ/পেমেন্টের জার্নাল, invoiceId বা billId — ঠিক একটি, amount > 0) | কোন টাকা কোন ইনভয়েসে — পেমেন্ট স্ট্যাটাস। DB CHECK দিয়ে জোর করা; MySQL ON UPDATE CASCADE-যুক্ত কলামে CHECK মানে না, তাই এই দুই FK-তে `ON UPDATE RESTRICT` (id কখনো বদলায় না) |
| `couriers` → পার্টি হিসেবে (বিদ্যমান টেবিল রাখা, partyType COURIER) | |

## ৪. ইনভেন্টরি (P03)

| টেবিল/কলাম | উদ্দেশ্য |
| --- | --- |
| `stock_ledgers` + `businessDate`, `unitCost` → DECIMAL(18,4), `totalCost` DECIMAL(18,2), `branchId` | N13 |
| `stock_balances.averageCost` DECIMAL(18,4) (আছে), + `reservedQty` DECIMAL(18,4) | রিজার্ভেশন |
| `expiry_batches` + `warehouseId`, `variantScope`, `@@unique([organizationId, warehouseId, productId, variantScope, lot, expiresOn])`, upsert | N14 |
| `stock_reservations` (orderId, orderItemId, productId, variantId, warehouseId, qty, status ACTIVE/RELEASED/CONSUMED) | অর্ডার CONFIRMED |
| `product_serials` + `warehouseId`, `variantId`, `status` enum(IN_STOCK, RESERVED, SOLD, RETURNED, DAMAGED), `inMovementId` | N4, L8 |
| `stock_documents` (একটি সাধারণ হেডার: type OPENING/OWN/ADJUST/DAMAGE/EXPIRY/TAKE_OFF/TRANSFER, number, businessDate, reason, takeOffPurpose, expenseAccountId NULL) | ছড়ানো টেবিলের বদলে একটি; পুরনোগুলো migration-এ এখানে আনা |
| movement type enum + `TAKE_OFF` | ফিচার ৮ |

**P03-এ যা হয়েছে:** সব ডকুমেন্ট `core/posting/stock`-এর `postWithStock` দিয়ে — স্টক মুভমেন্ট ও জার্নাল একসাথে, মূল্য গড় cost-এ, I3 প্রতি ব্রাঞ্চে যাচাই (জার্নাল লাইনে নিজের `branchId` থাকতে পারে; একই ব্রাঞ্চের দুই গুদামের ট্রান্সফারে হিসাব বদলায় না, জার্নালও নেই)। `stock_documents`-এ নম্বর `STK-<অর্থবছর>-<n>` (নতুন `STK` ডকুমেন্ট টাইপ); পুরনো `opening_stocks`, `own_stock_invoices`, `stock_adjustments`, `damage_records` সারি একই id-তে `stock_documents`-এ কপি হয়েছে — **পুরনো টেবিলগুলো মোছা হয়নি** (মালিকের অনুমতির অপেক্ষায়, `customer_ledgers`-এর মতো)। ট্রান্সফার `stock_transfers`-এই থাকে। `expiry_batches` গুদামভিত্তিক, লট প্রতি একটি সারি (upsert একটি SQL-এ)। IMEI/serial শুধু স্টক-ইনে (ক্রয়, opening, own stock) যোগ হয়, প্রতি ইউনিটে একটি; বিক্রিতে একটি শর্তসাপেক্ষ update (`IN_STOCK`, ওই গুদামে), `count = 1` না হলে বাতিল। `products.trackBatch` কলাম আছে কিন্তু আর ইনপুট নয় — `trackExpiry`-র সাথে একই মানে বসে (L7); কলামটি সরানো মালিকের কথার অপেক্ষায়। পুরনো ডাটাবেসের স্টক মেলাতে `scripts/stock-books.ts check|repair` ("v2 opening adjustment" জার্নাল, ব্রাঞ্চ প্রতি একটি)।

## ৫. ক্যাটালগ ও দাম (P04)

| টেবিল/কলাম | উদ্দেশ্য |
| --- | --- |
| `products` + `isService` BOOL (স্টক নেই), `vatRate` DECIMAL(5,2), `vatMode` enum(NONE, INCLUSIVE, EXCLUSIVE), `minQtyWholesale` NULL, `genericName` NULL, `unitId` | ফিচার ১২, non-stock (N8) |
| `price_levels` (id, name: Retail/Wholesale/Dealer/…, isDefault) | পাইকারি লেবেল |
| `product_prices` (productId, variantId NULL, priceLevelId, price, minQty ডিফল্ট ১) unique(product, variant, level, minQty) | লেভেল + পরিমাণভিত্তিক দাম |
| `customer_types.priceLevelId` | কাস্টমার টাইপ → দাম লেভেল |

**P04-এ যা হয়েছে:** `price_levels` (Retail ডিফল্ট, Wholesale, Dealer; মালিক আরও যোগ করেন), `product_prices` নতুন আকারে (`variantScope`, `priceLevelId`, `minQty`, `price`; unique org+পণ্য+variantScope+লেভেল+minQty) — বিদ্যমান `sellingPrice`/`wholesalePrice`/ভ্যারিয়েন্টের নিজস্ব দাম ব্যাকফিল হয়েছে; পণ্যের `sellingPrice`/`wholesalePrice` কলাম Retail/Wholesale-এর প্রথম ধাপের সাথে সিঙ্কে থাকে (বাকি সিস্টেম এখনো ওগুলো পড়ে; বিক্রি `resolvePrice`-এ যাবে P06-এ)। `products.isService`, `products.genericName` যোগ। **VAT:** নতুন `vatRate`/`vatMode` কলাম বানানো হয়নি — বিদ্যমান `vatType` (INCLUSIVE/EXCLUSIVE/খালি) ও `vatValue` (হার %) বিক্রি ইতিমধ্যে ব্যবহার করে, তাই সেগুলোই বৈধ মানসহ থাকল; নাম বদল P06-তে বিক্রি `resolvePrice`-এ গেলে। **মূল্য নির্বাচন:** লেভেল (নামে/কাস্টমার টাইপ থেকে/ডিফল্ট) → সবচেয়ে বড় `minQty ≤ পরিমাণ`; ভ্যারিয়েন্টের নিজস্ব দাম সেই লেভেলে পণ্যের দামের আগে; লেভেলে না থাকলে ডিফল্ট লেভেল; `minimumPrice`-এর নিচে নামে না (`floored`)। **D20:** `products.cost` পারমিশন ছাড়া পণ্যের ক্রয়মূল্য, avg cost, মার্জিন, স্টক মূল্য API/পেজ/এক্সপোর্টে আসে না। বারকোড: একাধিক, শপের নিজের EAN-13 (প্রিফিক্স 200, পরপর নম্বর, চেক ডিজিট; একই মুহূর্তে বানালেও আলাদা), লেবেল A4 বা ৩৮×২৫mm, লেভেলের দামসহ; প্রতিটি প্রিন্ট অডিটে (লেভেল, সাইজ, কপি)।
| `product_barcodes` (আছে) — variant সহ, unique(org, code) | ফিচার ১১ |

## ৬. ক্রয় (P05)

| টেবিল/কলাম | উদ্দেশ্য |
| --- | --- |
| `purchases` + `status` enum(DRAFT, ORDERED, RECEIVED, CANCELLED), `supplierInvoiceNo`, `discountTotal`, `vatTotal`, `transportCost`, `otherCost`, `grandTotal`, `paymentStatus` (হিসাবকৃত কলাম/ভিউ), `@@index([organizationId, branchId, status, businessDate])` | B9, D4 |
| `purchase_items` + `discount`, `vatAmount`, `landedUnitCost` DECIMAL(18,4), `lot`, `expiresOn` | |
| `vendor_payments` (number, vendorId, method accountId, amount, charge, businessDate) | পেমেন্ট ডকুমেন্ট |

**P05-এ যা হয়েছে:** `purchases.status` এখন DRAFT → ORDERED → RECEIVED (CANCELLED শুধু RECEIVED-এর আগে); পুরনো `POSTED` সারি একটি মাইগ্রেশনে `RECEIVED` হয়েছে (`receivedOn` = বিলের তারিখ, `landedUnitCost` = `unitCost`)। নম্বর (`PUR-…`) DRAFT ছাড়ার সময় (অর্ডার বা সরাসরি গ্রহণ) বসে, তাই খসড়া নম্বরে ফাঁক রাখে না। **`total` = Vendor-কে যা দিতে হবে** (পণ্য − ডিসকাউন্ট + VAT, পরিবহন বাদে) — আলাদা `grandTotal` কলাম বানানো হয়নি; পরিবহনসহ মোট খরচ = `total + chargesTotal` (`chargesTotal` = `transportCost + otherCost`)। `paymentStatus` সংরক্ষিত নয় — আগের মতোই বই ও `payment_allocations` থেকে হিসাব। নতুন কলাম: `supplierInvoiceNo`, `headerDiscount`, `transportCost`, `otherCost`, `receivedOn`, `transporterId` (Vendor টেবিলেরই একজন; FK নেই, কোডে যাচাই), `vehicleNo`, `transportPaidWith` (CASH/BANK/CREDIT), `note`; `purchase_items`-এ `position` (লাইনের ক্রম), `discount`, `vatRate`, `vatAmount`, `landedUnitCost` (৪ দশমিক), `lot`, `manufacturedOn`, `expiresOn`, `serials`। `purchase_items.lineTotal` = Vendor ওই লাইনের জন্য যা ধরেছে (হেডার ডিসকাউন্টের ভাগের পর, VAT সহ) — ফেরতের টাকা এ থেকেই। **`vendor_payments` নতুন টেবিল নয়:** বিদ্যমান `supplier_payments`-এ `accountId` ও `charge` যোগ; অগ্রিম ব্যবহার একই টেবিলে `method = 'ADVANCE'` (টাকা নড়ে না, তাই নগদ-প্রবাহের মোটে ধরা হয় না)। নতুন `supplier_advances` (number — পেমেন্টের সাথে একই `PAY` ক্রম, accountId, amount) ও ডকুমেন্ট টাইপ `SUPPLIER_ADVANCE`। **হিসাব:** গ্রহণে একটি জার্নাল — Dr Inventory (landed) / Cr AP(Vendor) (বিল) / Cr নগদ-ব্যাংক বা AP(পরিবহনকারী) (পরিবহন+অন্যান্য) / ±PPV (চার দশমিকের ছাঁটাইয়ের পয়সা); বিলের পাওনা হিসাবে শুধু Vendor-এর AP লাইন গোনা হয় (পরিবহনকারীর বাকি আলাদা পাওনা)। খরচ ভাগ: লাইন ডিসকাউন্ট, হেডার ডিসকাউন্ট (মূল্য-অনুপাতে, সবচেয়ে বড় ভগ্নাংশে পয়সা), VAT (খরচের অংশ, D2), পরিবহন ও অন্যান্য (মূল্য-অনুপাতে) — যোগফল সবসময় হুবহু বিল + পরিবহন।

## ৭. বিক্রি ও অর্ডার (P06)

| টেবিল/কলাম | উদ্দেশ্য |
| --- | --- |
| `sales_orders` (number `ORD-`, customerId, channel enum(POS, PHONE, FACEBOOK, WEBSITE, OTHER), status, priceLevelId, deliveryMethod enum(PICKUP, OWN_VEHICLE, COURIER), shippingAddress, districtId, upazilaId, externalRef, expectedDate) | ফিচার ১৪, অর্ডার রেফারেন্স |
| `sales_order_items` | |
| `sales` (ইনভয়েস) + `orderId` NULL, `shiftId`, `priceLevelId`, `discountTotal`, `vatTotal`, `chargeTotal`, `grandTotal`, `paymentStatus`, `districtId` (কাস্টমার থেকে কপি — রিপোর্টের জন্য স্থির) | N7, রিপোর্ট |
| `sale_items` + `priceLevelId`, `unitCost` DECIMAL(18,4) (পোস্টের সময়ের avg) | |
| `receipts` (number `RCV-`, customerId, accountId, amount, charge, shiftId, businessDate) | রসিদ ডকুমেন্ট |
| `sale_returns` + `refundMethod` enum(CASH, BANK, MOBILE, ADVANCE, AR_ONLY), `refundAccountId` | N12 |
| `direct_returns` | **বাদ** (N10)। বিক্রি ছাড়া ফেরত = "রিসিপ্ট ছাড়া ফেরত" ফ্লো, সর্বোচ্চ বর্তমান বিক্রয়মূল্য, পারমিশন `returns.without_invoice`, অনুমোদনকারী লাগবে |
| `held_tickets` | থাকছে; ধরার সময় স্টক সতর্কতা (B7) |

## ৮. পরিবহন (P07)

| টেবিল/কলাম | উদ্দেশ্য |
| --- | --- |
| `shipments` (number `SHP-`, saleId, courierId NULL, vehicleNo NULL, driverName/phone NULL, method, trackingCode, codAmount, deliveryCharge, conditionCharge, status enum(CREATED, PICKED, IN_TRANSIT, DELIVERED, PARTIAL, RETURNED, LOST), dispatchedOn, deliveredOn) | ফিচার ৭, ৯ |
| `shipment_events` (shipmentId, status, at, note) | ট্র্যাকিং (ফিচার ১৩) |
| `courier_settlements` (number, courierId, accountId, grossCod, deliveryCharges, conditionCharges, netReceived, businessDate) + `courier_settlement_items` (shipmentId) | |
| `couriers` + `defaultConditionPercent`, `defaultDeliveryCharge`, `apiProvider` NULL | |

## ৯. টাকা, খরচ, শিফট (P08)

| টেবিল/কলাম | উদ্দেশ্য |
| --- | --- |
| `expense_categories` (name, accountId, type enum(MONTHLY_FIXED, VARIABLE, MISC)) | ফিচার ১০ |
| `expenses` + `categoryId`, `accountId` (MONEY), `charge`, `businessDate`, `periodMonth` (কোন মাসের খরচ) | |
| `recurring_expenses` (categoryId, amount, dayOfMonth, active) — মাস শুরুতে খসড়া তৈরি | মাসিক খরচ |
| `contra_transfers` (from, to, amount, charge) | |
| `shifts` + `cashAccountId`; expected cash = shiftId-যুক্ত CASH লাইনের যোগফল + opening (N7) | |
| `payment_method_charges` (accountId, percent, fixed, bearer enum(SHOP, CUSTOMER)) | ফিচার ৯, D7 |

## ১০. সম্পদ (P09)

`fixed_assets` (code, name, category, purchaseDate, cost, salvageValue, usefulLifeMonths, method enum(STRAIGHT_LINE), location/branchId, status enum(ACTIVE, DISPOSED), disposedOn, disposalAmount), `depreciation_runs` (month, journalId) unique(org, month)।

## ১১. কাস্টমার ও CRM (P10)

| টেবিল/কলাম | উদ্দেশ্য |
| --- | --- |
| `divisions`, `districts` (৬৪), `upazilas` (সিড, বাংলা + ইংরেজি নাম) | জেলাভিত্তিক তথ্য |
| `customers` + `code` (unique), `districtId`, `upazilaId`, `altPhone`, `nid` NULL, `businessName`, `tags`, `@@index([organizationId, phone])`, `@@index([organizationId, districtId])` | সার্চ |
| `vendors` (= suppliers) + `districtId`, `code`, `contactPerson`, `bankDetails` | |
| `sms_campaigns` (name, segmentFilter JSON-নয় → `sms_campaign_filters` টেবিল, templateId, status, scheduledAt, counts) + `sms_messages.campaignId` | অফার মেসেজ |
| `sms_outbox` (status QUEUED/SENT/FAILED, attempts, nextAttemptAt) | B13 |

## ১২. রিপোর্ট সহায়ক (P11)

`daily_snapshots` (organizationId, branchId, businessDate, metric enum, accountId/partyId NULL, value) — দিন বন্ধের পর লেখা; পরিবর্তন হলে (back-date) সেই দিন থেকে পুনর্গণনা।
