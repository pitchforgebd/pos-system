const currencyFormatters = new Map<string, Intl.NumberFormat>();

function formatterFor(currency: string) {
  const existing = currencyFormatters.get(currency);
  if (existing) {
    return existing;
  }

  const created = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: "code",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  currencyFormatters.set(currency, created);
  return created;
}

/** Display formatting only. Not a financial calculation. */
export function formatMoney(amount: number, currency: string) {
  return formatterFor(currency).format(amount).replace(/\u00a0/g, " ");
}
