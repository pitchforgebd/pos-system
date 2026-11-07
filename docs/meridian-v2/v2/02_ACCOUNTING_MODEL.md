# হিসাব মডেল v2

প্রতিটি টাকা বা স্টকের ঘটনা ডাবল-এন্ট্রি জার্নাল তৈরি করে। এই টেবিলের বাইরে কোনো পোস্টিং নিষেধ। নতুন ঘটনা যোগ করতে হলে আগে এখানে লাইন যোগ করে অনুমোদন।

## ১. চার্ট অব অ্যাকাউন্টস (সিড)

কোডগুলো সিড-ডিফল্ট। কোড কোথাও হার্ডকোড হবে না; কোড আসে `account_roles` থেকে (`accountFor("CASH")`)। `isSystem = true` অ্যাকাউন্ট নিষ্ক্রিয় বা মোছা যাবে না (N27)।

| কোড | নাম | রোল | ধরন | নোট |
| --- | --- | --- | --- | --- |
| 1100 | Cash in Hand | CASH | Asset | branch ও shift ডাইমেনশনসহ |
| 1201–1249 | ব্যাংক অ্যাকাউন্ট (প্রতিটি আলাদা) | BANK:* | Asset | নাম, নম্বর, শাখা |
| 1251–1279 | মোবাইল ব্যাংক (bKash, Nagad, Rocket …) | MOBILE:* | Asset | প্রতিটি নম্বর আলাদা অ্যাকাউন্ট |
| 1300 | Accounts Receivable (কাস্টমার বাকি) | AR | Asset | partyId বাধ্যতামূলক |
| 1350 | Courier Receivable (Condition টাকা) | COURIER_AR | Asset | partyId = কুরিয়ার |
| 1400 | Inventory | INVENTORY | Asset | branch ডাইমেনশন |
| 1500 | Input VAT | INPUT_VAT | Asset | D2 অনুযায়ী ব্যবহৃত |
| 1600 | Fixed Assets | FIXED_ASSET | Asset | asset ডাইমেনশন |
| 1690 | Accumulated Depreciation | ACCUM_DEPR | Contra-asset | |
| 2100 | Accounts Payable (Vendor বাকি) | AP | Liability | partyId বাধ্যতামূলক |
| 2150 | Customer Advance | CUSTOMER_ADVANCE | Liability | partyId (N16) |
| 1450 | Advance to Vendor | VENDOR_ADVANCE | Asset | partyId |
| 2200 | Loans Payable | LOAN | Liability | |
| 2300 | VAT Payable (Output) | OUTPUT_VAT | Liability | |
| 2400 | Accrued Expenses | ACCRUED | Liability | মাস শেষের বকেয়া খরচ |
| 3100 | Owner Capital | CAPITAL | Equity | |
| 3200 | Drawings | DRAWINGS | Equity | |
| 3800 | Retained Earnings | RETAINED | Equity | বছর শেষে ক্লোজিং |
| 3900 | Opening Balance Equity | OPENING_EQUITY | Equity | সব opening এখানে (LV-2) |
| 4100 | Sales | SALES | Revenue | নিট (ডিসকাউন্ট বাদে, VAT বাদে) |
| 4200 | Delivery & Other Charges Income | CHARGE_INCOME | Revenue | কাস্টমার থেকে নেওয়া ডেলিভারি চার্জ |
| 4300 | Inventory Gain | INVENTORY_GAIN | Revenue | +adjustment |
| 4400 | Other Income | OTHER_INCOME | Revenue | |
| 5100 | Cost of Goods Sold | COGS | Expense | |
| 5200 | Inventory Loss (damage/expiry/−adj) | INVENTORY_LOSS | Expense | |
| 5300 | Purchase Price Variance | PPV | Expense | supplier return-এর পার্থক্য (N11) |
| 6100 | Rent | — | Expense | খরচের খাত (সম্পাদনযোগ্য) |
| 6200 | Salary | — | Expense | |
| 6300 | Utilities | — | Expense | |
| 6400 | Marketing & Offers | — | Expense | |
| 6500 | Loyalty Discount | LOYALTY | Expense | D14 |
| 6600 | Bank Charges | BANK_CHARGE | Expense | |
| 6610 | Mobile Banking Charges | MOBILE_CHARGE | Expense | |
| 6700 | Transport / Delivery Expense | TRANSPORT | Expense | কুরিয়ার/ট্রাক ভাড়া |
| 6710 | Condition (COD) Charge | COD_CHARGE | Expense | |
| 6800 | Depreciation | DEPRECIATION | Expense | |
| 6900 | Miscellaneous (বিবিধ) | MISC | Expense | |

খরচের খাত মালিক নিজে যোগ করতে পারবেন (6000 গ্রুপে); সিস্টেম রোলগুলো স্থির।

## ২. পোস্টিং ম্যাট্রিক্স

সংকেত: Dr = ডেবিট, Cr = ক্রেডিট, `(P)` = partyId লাগে, `MONEY` = ক্যাশ/ব্যাংক/মোবাইল যেটা বাছাই, `avg` = স্টক ইঞ্জিনের moving-average cost।

### স্টক ও ওপেনিং

| # | ঘটনা | জার্নাল | স্টক |
| --- | --- | --- | --- |
| 1 | Opening stock | Dr INVENTORY / Cr OPENING_EQUITY (qty × unitCost) | IN `OPENING` |
| 2 | Own stock (মালিকের দেওয়া মাল) | Dr INVENTORY / Cr CAPITAL | IN `OWN_STOCK` |
| 3 | কাস্টমার opening বাকি | Dr AR(P) / Cr OPENING_EQUITY | — |
| 4 | Vendor opening বাকি | Dr OPENING_EQUITY / Cr AP(P) | — |
| 5 | ক্যাশ/ব্যাংক opening | Dr MONEY / Cr OPENING_EQUITY | — |
| 6 | Adjustment + | Dr INVENTORY / Cr INVENTORY_GAIN (avg) | IN `ADJUSTMENT` |
| 7 | Adjustment − | Dr INVENTORY_LOSS / Cr INVENTORY (avg) | OUT `ADJUSTMENT` |
| 8 | Damage / Expiry | Dr INVENTORY_LOSS / Cr INVENTORY (avg) | OUT `DAMAGE`/`EXPIRY` |
| 9 | Take-off (D1) | Dr DRAWINGS বা বাছাই করা খরচ খাত / Cr INVENTORY (avg) | OUT `TAKE_OFF` |
| 10 | Branch transfer | Dr INVENTORY [dest branch] / Cr INVENTORY [src branch] (avg) | OUT+IN |

### ক্রয়

| # | ঘটনা | জার্নাল | স্টক |
| --- | --- | --- | --- |
| 11 | ক্রয় বিল (RECEIVED) | Dr INVENTORY (landed cost) [+ Dr INPUT_VAT যদি D2 = হ্যাঁ] / Cr AP(P) (বিল মোট) | IN `PURCHASE` (landed unit cost) |
| 12 | ক্রয়ে পরিবহন খরচ (আলাদা পরিবহনকারী) | Dr INVENTORY / Cr MONEY বা AP(পরিবহনকারী) | cost লাইনে ভাগ (মূল্য অনুপাতে) |
| 13 | Vendor পেমেন্ট | Dr AP(P) / Cr MONEY; চার্জ: Dr BANK_CHARGE বা MOBILE_CHARGE / Cr MONEY | — |
| 14 | Vendor অগ্রিম | Dr VENDOR_ADVANCE(P) / Cr MONEY | — |
| 15 | অগ্রিম বিলে সমন্বয় | Dr AP(P) / Cr VENDOR_ADVANCE(P) | — |
| 16 | Supplier return | Dr AP(P) (বিল দাম) / Cr INVENTORY (avg); পার্থক্য Dr/Cr PPV | OUT `SUPPLIER_RETURN` |

### বিক্রি

সব বিক্রি AR দিয়ে যায় — নগদ বিক্রিও (walk-in = সিস্টেম কাস্টমার "Walk-in")। একই transaction-এ রসিদ পোস্ট হয়। এতে প্রতিটি ইনভয়েসের পেমেন্ট স্ট্যাটাস একই নিয়মে হিসাব হয়।

| # | ঘটনা | জার্নাল | স্টক |
| --- | --- | --- | --- |
| 17 | ইনভয়েস (DISPATCHED বা POS) | Dr AR(P) মোট / Cr SALES নিট, Cr OUTPUT_VAT, Cr CHARGE_INCOME; Dr COGS / Cr INVENTORY (avg) | OUT `SALE` |
| 18 | কাস্টমার রসিদ | Dr MONEY (নিট) + Dr MOBILE_CHARGE/BANK_CHARGE (কেটে রাখা চার্জ, D7) / Cr AR(P) (মোট) | — |
| 19 | কাস্টমার অগ্রিম | Dr MONEY / Cr CUSTOMER_ADVANCE(P) | — |
| 20 | অগ্রিম ইনভয়েসে সমন্বয় (wallet) | Dr CUSTOMER_ADVANCE(P) / Cr AR(P) | — |
| 21 | সেল রিটার্ন | Dr SALES (অনুপাতিক নিট), Dr OUTPUT_VAT, [Dr CHARGE_INCOME যদি চার্জ ফেরত] / Cr AR(P); Dr INVENTORY / Cr COGS (মূল সেলের cost) | IN `CUSTOMER_RETURN` (লটে ফেরত) |
| 22 | রিফান্ড | Dr AR(P) / Cr MONEY (মূল মেথড ডিফল্ট, N12); বা Dr AR(P) / Cr CUSTOMER_ADVANCE(P) | — |
| 23 | Loyalty redeem (D14) | ইনভয়েসের ডিসকাউন্ট হিসেবে: Dr LOYALTY / Cr AR(P) | — |

### পরিবহন ও Condition (COD)

| # | ঘটনা | জার্নাল |
| --- | --- | --- |
| 24 | কুরিয়ারে হস্তান্তর (COD টাকা X) | Dr COURIER_AR(কুরিয়ার) / Cr AR(কাস্টমার) — X |
| 25 | কুরিয়ারের ডেলিভারি চার্জ | Dr TRANSPORT / Cr COURIER_AR(কুরিয়ার) (সেটেলমেন্ট থেকে কাটবে) বা Cr MONEY (নগদে দিলে) |
| 26 | Condition চার্জ | Dr COD_CHARGE / Cr COURIER_AR(কুরিয়ার) |
| 27 | কুরিয়ার সেটেলমেন্ট | Dr MONEY / Cr COURIER_AR(কুরিয়ার) |
| 28 | পার্সেল ফেরত (ডেলিভারি হয়নি) | Dr AR(কাস্টমার) / Cr COURIER_AR(কুরিয়ার), তারপর #21 সেল রিটার্ন (পূর্ণ) |
| 29 | নিজস্ব গাড়ি/ট্রাক ভাড়া | Dr TRANSPORT / Cr MONEY |

### টাকা, খরচ ও সম্পদ

| # | ঘটনা | জার্নাল |
| --- | --- | --- |
| 30 | খরচ (মাসিক/বিবিধ) | Dr খরচ খাত / Cr MONEY বা ACCRUED |
| 31 | Contra (ক্যাশ↔ব্যাংক↔মোবাইল) | Dr প্রাপক / Cr প্রেরক; চার্জ Dr BANK_CHARGE/MOBILE_CHARGE / Cr প্রেরক |
| 32 | ব্যাংক চার্জ (স্টেটমেন্টে) | Dr BANK_CHARGE / Cr BANK |
| 33 | অন্যান্য আয় | Dr MONEY / Cr OTHER_INCOME |
| 34 | মূলধন যোগ / উত্তোলন | Dr MONEY / Cr CAPITAL ; Dr DRAWINGS / Cr MONEY |
| 35 | ঋণ গ্রহণ / পরিশোধ | Dr MONEY / Cr LOAN ; Dr LOAN (+ সুদ Dr 6900) / Cr MONEY |
| 36 | সম্পদ ক্রয় | Dr FIXED_ASSET / Cr MONEY বা AP(P) |
| 37 | মাসিক অবচয় | Dr DEPRECIATION / Cr ACCUM_DEPR |
| 38 | সম্পদ বিক্রি/বাতিল | Dr MONEY, Dr ACCUM_DEPR / Cr FIXED_ASSET; লাভ Cr OTHER_INCOME, ক্ষতি Dr 6900 |
| 39 | শিফট ক্যাশ শর্ট/ওভার | Dr 6900 / Cr CASH (শর্ট) ; Dr CASH / Cr OTHER_INCOME (ওভার) |

## ৩. গণনার নিয়ম

- টাকা: স্কেল ২, half-up। পরিমাণ ও unit cost: স্কেল ৪ (N13)।
- লাইন: `gross = qty × unitPrice`; `discount ≤ gross`; VAT inclusive হলে `vat = net × rate/(100+rate)`, exclusive হলে `vat = net × rate/100`; ইনভয়েস ডিসকাউন্ট লাইনগুলোতে অনুপাতে ভাগ (largest-remainder, যাতে যোগফল হুবহু মেলে)।
- রিটার্ন: অনুপাতিক; শেষ ইউনিটে অবশিষ্ট (বর্তমান C3 নিয়ম বজায়)।
- গড় দাম: স্টক-ইনে মেশে, স্টক-আউটে বদলায় না; supplier return-এ পার্থক্য PPV-তে, তাই `GL 1400 = Σ qty × avg` সবসময় সত্য।
- পার্টি ব্যালান্স: `Σ(debit − credit)` সেই পার্টির AR/COURIER_AR/VENDOR_ADVANCE লাইন; AP/CUSTOMER_ADVANCE-এ উল্টো।

## ৪. পিরিয়ড ও বছর

- অর্থবছর D9 অনুযায়ী (ডিফল্ট জুলাই–জুন)।
- `lockedThrough` তারিখের আগে বা তার দিন কোনো পোস্টিং নয়। ভবিষ্যতের তারিখ সর্বোচ্চ আজ (ঢাকা)। পেছনের তারিখে পোস্ট `posting.backdate` পারমিশন লাগে, সর্বোচ্চ সেটিং-এর দিনসংখ্যা (ডিফল্ট ৩)।
- বছর শেষ: আয়-ব্যয় → RETAINED ক্লোজিং জার্নাল (P11)।
