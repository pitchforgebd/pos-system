-- AlterTable: the day the books start (opening balances are dated this day; found by the 7-day user test)
ALTER TABLE `organizations` ADD COLUMN `booksStartOn` DATE NULL;
