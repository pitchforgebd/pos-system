"use client";

import Link from "next/link";
import { businessDate } from "@/core/time/business-date";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

type RegisterProduct = {
  id: string;
  sku: string;
  name: string;
  sellingPrice: string;
  minimumPrice: string;
  vatType: string | null;
  vatValue: string | null;
  trackSerial: boolean;
  brandId: string | null;
  brandName: string;
  categoryId: string | null;
  categoryName: string;
  barcode: string;
  barcodes: string[];
  stock: string;
  hasImage: boolean;
};
type NamedOption = { id: string; name: string };
type Tender = "CASH" | "BANK" | "CARD" | "WALLET";
type RegisterCustomer = { id: string; name: string; phone: string | null; outstanding: string };
type CartLine = {
  productId: string;
  name: string;
  sku: string;
  sellingPrice: string;
  unitPrice: string;
  minimumPrice: string;
  vatType: string | null;
  vatValue: string | null;
  quantity: string;
  trackSerial: boolean;
  serial: string;
};

function today() {
  return businessDate();
}

const zero = BigInt(0);
const two = BigInt(2);
const hundred = BigInt(100);

function cents(value: string) {
  const [whole, frac = ""] = value.split(".");
  return BigInt(whole || "0") * hundred + BigInt((frac + "00").slice(0, 2));
}

function money(value: bigint) {
  const sign = value < zero ? "-" : "";
  const abs = value < zero ? -value : value;
  return `${sign}${abs / hundred}.${(abs % hundred).toString().padStart(2, "0")}`;
}

function lineCents(price: string, quantity: string) {
  if (!/^\d+\.\d{2}$/.test(price) || !/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(quantity)) {
    return zero;
  }
  const [whole, frac = ""] = quantity.split(".");
  const scale = BigInt(10) ** BigInt(frac.length);
  const units = BigInt(whole || "0") * scale + BigInt(frac || "0");
  const product = cents(price) * units;
  return (product + scale / two) / scale;
}

function vatCents(vatType: string | null, vatValue: string | null, base: bigint) {
  if (!vatType || !vatValue || !/^\d+\.\d{2}$/.test(vatValue)) {
    return zero;
  }
  const rate = cents(vatValue);
  if (rate <= zero) {
    return zero;
  }
  const type = vatType.toUpperCase();
  if (type === "EXCLUSIVE" || type === "PERCENT") {
    return (base * rate + BigInt(5000)) / BigInt(10000);
  }
  if (type === "INCLUSIVE") {
    const denom = BigInt(10000) + rate;
    const net = (base * BigInt(10000) + denom / two) / denom;
    const vat = base - net;
    return vat > zero ? vat : zero;
  }
  return zero;
}

function allocateDiscount(grosses: bigint[], discount: bigint) {
  const gross = grosses.reduce((sum, line) => sum + line, zero);
  const capped = discount > gross ? gross : discount < zero ? zero : discount;
  const shares = grosses.map(() => zero);
  let remaining = capped;
  for (let index = 0; index < grosses.length; index += 1) {
    const last = index === grosses.length - 1;
    let share = last || gross === zero ? remaining : (capped * grosses[index]) / gross;
    if (share > grosses[index]) {
      share = grosses[index];
    }
    if (share > remaining) {
      share = remaining;
    }
    shares[index] = share;
    remaining -= share;
  }
  for (let index = grosses.length - 1; index >= 0 && remaining > zero; index -= 1) {
    const room = grosses[index] - shares[index];
    const extra = remaining > room ? room : remaining;
    shares[index] += extra;
    remaining -= extra;
  }
  return shares;
}

function addOne(quantity: string) {
  const [whole, frac = ""] = quantity.split(".");
  if (!frac) {
    return String(BigInt(whole || "0") + BigInt(1));
  }
  const scale = BigInt(10) ** BigInt(frac.length);
  const next = BigInt(whole || "0") * scale + BigInt(frac) + scale;
  const fraction = (next % scale).toString().padStart(frac.length, "0");
  return `${next / scale}.${fraction}`;
}

export function SaleForm({
  products,
  customers,
  brands,
  categories,
  branchName,
  canDiscount,
  canOverride,
}: {
  products: RegisterProduct[];
  customers: RegisterCustomer[];
  brands: NamedOption[];
  categories: NamedOption[];
  branchName: string;
  canDiscount: boolean;
  canOverride: boolean;
}) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [barcode, setBarcode] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [extraPay, setExtraPay] = useState(false);
  const [saleDate, setSaleDate] = useState(today);
  const [tender, setTender] = useState<Tender>("CASH");
  const [cash, setCash] = useState("");
  const [cashEdited, setCashEdited] = useState(false);
  const [discountText, setDiscountText] = useState("0.00");
  const [chargesText, setChargesText] = useState("0.00");
  const [message, setMessage] = useState("");
  const sending = useSubmit();
  const pending = sending.pending;
  const shownMessage = message || sending.message;
  const discountRef = useRef<HTMLInputElement>(null);
  const chargesRef = useRef<HTMLInputElement>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const productsRef = useRef(products);
  const extraRef = useRef<RegisterProduct[]>([]);
  const scanRef = useRef({ buffer: "", last: 0 });
  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  const grosses = cart.map((line) => lineCents(line.unitPrice, line.quantity));
  const gross = grosses.reduce((sum, line) => sum + line, zero);
  const discountAmount = canDiscount && /^\d+\.\d{2}$/.test(discountText) ? cents(discountText) : zero;
  const discounts = allocateDiscount(grosses, discountAmount);
  const chargesAmount = /^\d+\.\d{2}$/.test(chargesText) ? cents(chargesText) : null;
  const priced = cart.map((line, index) => {
    const afterDiscount = grosses[index] - discounts[index];
    const vat = vatCents(line.vatType, line.vatValue, afterDiscount);
    const inclusive = (line.vatType ?? "").toUpperCase() === "INCLUSIVE";
    const payable = inclusive ? afterDiscount : afterDiscount + vat;
    return { vat, payable, discount: discounts[index] };
  });
  const vatTotal = priced.reduce((sum, line) => sum + line.vat, zero);
  const payable = priced.reduce((sum, line) => sum + line.payable, zero) + (chargesAmount ?? zero);
  const totalText = money(payable);
  const cashText = cashEdited ? cash : totalText;
  const cashAmount = /^\d+(\.\d{1,2})?$/.test(cashText) ? cents(cashText) : null;
  const postedPay = cashAmount === null ? null : cashAmount > payable ? payable : cashAmount;
  const change = cashAmount === null || postedPay === null ? null : cashAmount - postedPay;
  const due = postedPay === null ? null : payable - postedPay;
  const customer = customers.find((item) => item.id === customerId) ?? null;
  const previous = customer && /^-?\d+\.\d{2}$/.test(customer.outstanding) ? cents(customer.outstanding) : zero;
  const previousDue = previous > zero ? previous : zero;
  const advance = previous < zero ? -previous : zero;

  const shelf = useMemo(() => {
    const needle = productQuery.trim().toLowerCase();
    return products
      .filter((product) => {
        if (categoryId && product.categoryId !== categoryId) {
          return false;
        }
        if (brandId && product.brandId !== brandId) {
          return false;
        }
        if (!needle) {
          return true;
        }
        return `${product.sku} ${product.name} ${product.barcode} ${product.barcodes.join(" ")}`.toLowerCase().includes(needle);
      })
      .slice(0, 24);
  }, [brandId, categoryId, productQuery, products]);

  const customerMatches = useMemo(() => {
    const needle = customerQuery.trim().toLowerCase();
    if (needle.length < 1) {
      return [];
    }
    return customers
      .filter((item) => `${item.name} ${item.phone ?? ""}`.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [customerQuery, customers]);

  const addProduct = useCallback((product: RegisterProduct) => {
    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (!existing) {
        return [
          ...current,
          {
            productId: product.id,
            name: product.name,
            sku: product.sku,
            sellingPrice: product.sellingPrice,
            unitPrice: product.sellingPrice,
            minimumPrice: product.minimumPrice,
            vatType: product.vatType,
            vatValue: product.vatValue,
            quantity: "1",
            trackSerial: product.trackSerial,
            serial: "",
          },
        ];
      }
      if (existing.trackSerial) {
        return current;
      }
      return current.map((line) => (line.productId === product.id ? { ...line, quantity: addOne(line.quantity) } : line));
    });
    setBarcode("");
    setMessage("");
  }, []);

  const productForCode = useCallback((code: string) => {
    const needle = code.trim().toLowerCase();
    if (!needle) {
      return null;
    }
    return [...productsRef.current, ...extraRef.current].find(
      (item) => item.sku.toLowerCase() === needle || item.barcodes.some((value) => value.toLowerCase() === needle) || item.barcode.toLowerCase() === needle,
    ) ?? null;
  }, []);

  function addBarcode() {
    const product = productForCode(barcode);
    if (!barcode.trim()) {
      return;
    }
    if (!product) {
      void lookupBarcode(barcode.trim());
      return;
    }
    addProduct(product);
    barcodeRef.current?.focus();
  }

  const lookupBarcode = useCallback(async (code: string) => {
    const response = await fetch(`/api/v1/pos/barcode?code=${encodeURIComponent(code)}`);
    const body = (await response.json().catch(() => null)) as { data?: RegisterProduct } | null;
    if (!response.ok || !body?.data) {
      setBarcode("");
      setMessage("No product matches that barcode.");
      barcodeRef.current?.focus();
      return;
    }
    extraRef.current = [body.data, ...extraRef.current.filter((item) => item.id !== body.data?.id)];
    addProduct(body.data);
    barcodeRef.current?.focus();
  }, [addProduct]);

  useEffect(() => {
    barcodeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1 && event.key !== "Enter" && event.key !== "Tab") {
        return;
      }
      const now = performance.now();
      const scan = scanRef.current;
      if (event.key === "Enter" || event.key === "Tab") {
        const code = scan.buffer;
        const fast = code.length >= 4 && now - scan.last <= 80;
        scan.buffer = "";
        if (!fast) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const target = event.target;
        if (target instanceof HTMLInputElement && target !== barcodeRef.current && target.value.endsWith(code[0] ?? "")) {
          const next = target.value.slice(0, -1);
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          setter?.call(target, next);
          target.dispatchEvent(new Event("input", { bubbles: true }));
        }
        const local = productForCode(code);
        if (local) {
          addProduct(local);
          barcodeRef.current?.focus();
          return;
        }
        void lookupBarcode(code);
        return;
      }
      if (now - scan.last > 80) {
        scan.buffer = "";
      }
      scan.last = now;
      scan.buffer += event.key;
      if (event.target !== barcodeRef.current && scan.buffer.length > 1) {
        event.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [addProduct, lookupBarcode, productForCode]);

  function clearSale() {
    setCart([]);
    setCustomerId("");
    setCustomerQuery("");
    setProductQuery("");
    setCash("");
    setCashEdited(false);
    setDiscountText("0.00");
    setChargesText("0.00");
    setMessage("");
  }

  function submit(hold: boolean, method: Tender = tender) {
    if (cart.length === 0) {
      setMessage("Add a product before selling.");
      return;
    }
    if (!hold) {
      if (cashAmount === null) {
        setMessage("Enter a cash amount with up to two decimals.");
        return;
      }
      if (chargesAmount === null) {
        setMessage("Enter other charges as 0.00 or a larger amount.");
        return;
      }
      if (canDiscount && !/^\d+\.\d{2}$/.test(discountText)) {
        setMessage("Enter the discount as 0.00 or a larger amount.");
        return;
      }
      if (discountAmount > gross) {
        setMessage("The discount is greater than the sale.");
        return;
      }
      if (due !== null && due > zero && !customerId) {
        setMessage("Choose a customer for the unpaid amount.");
        return;
      }
      if (method === "WALLET" && !customerId) {
        setMessage("Choose a customer for a wallet payment.");
        return;
      }
      if (cart.some((line) => line.trackSerial && !line.serial.trim())) {
        setMessage("Enter the IMEI for each serial product.");
        return;
      }
    }
    setTender(method);
    setMessage("");
    const lines = cart.map((line, index) => ({
      productId: line.productId,
      quantity: line.quantity,
      ...(line.unitPrice !== line.sellingPrice ? { unitPrice: line.unitPrice } : {}),
      discountAmount: money(priced[index]?.discount ?? zero),
      vatAmount: money(priced[index]?.vat ?? zero),
      ...(line.trackSerial ? { serial: line.serial.trim(), quantity: "1" } : {}),
    }));
    const body = hold
      ? { customerId: customerId || undefined, lines }
      : {
          businessDate: saleDate,
          customerId: customerId || undefined,
          chargesTotal: chargesText,
          paymentAmount: money(postedPay ?? zero),
          paymentMethod: postedPay && postedPay > zero ? method : undefined,
          lines,
        };
    // One key per attempt: if the answer is lost, pressing again sends the same key and the server saves one sale.
    void sending.submit<{ id: string }>(
      { url: hold ? "/api/v1/pos/tickets" : "/api/v1/sales", body },
      {
        successMessage: hold ? "টিকিট রাখা হয়েছে। (Ticket held.)" : "বিক্রয় সংরক্ষিত হয়েছে। (Sale saved.)",
        goTo: (data) => (hold ? "/pos/open-tickets" : `/sales/${data.id}`),
      },
    );
  }

  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "F9") {
        event.preventDefault();
        submitRef.current(false);
      }
      if (event.key === "F6") {
        event.preventDefault();
        discountRef.current?.focus();
      }
      if (event.altKey && event.key.toLowerCase() === "g") {
        event.preventDefault();
        chargesRef.current?.focus();
      }
      if (event.altKey && event.key.toLowerCase() === "m") {
        event.preventDefault();
        submitRef.current(false, "CARD");
      }
      if (event.altKey && event.key.toLowerCase() === "u") {
        event.preventDefault();
        setExtraPay((open) => !open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const subtotal = payable;
  const selectClass = "h-9 w-full rounded-md border border-border bg-white px-2 text-sm";

  return (
    <form
      className="overflow-hidden rounded-xl border border-border bg-[#f3f6fb]"
      onSubmit={(event) => {
        event.preventDefault();
        submit(false, "CASH");
      }}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-white px-3 py-2">
        <span className="text-sm font-semibold text-[#123a63]">{branchName}</span>
        <input aria-label="Date" type="date" required value={saleDate} onChange={(event) => setSaleDate(event.target.value)} className="h-8 rounded-md border border-border px-2 text-sm" />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" className="h-9 rounded-md bg-[#1f9d55] px-3 text-sm font-semibold text-white" onClick={() => { setCustomerId(""); setCustomerOpen(false); }}>
            Walking
          </button>
          <button type="button" className="h-9 rounded-md border border-[#1f9d55] bg-white px-3 text-sm font-semibold text-[#1f9d55]" onClick={() => setCustomerOpen((open) => !open)}>
            Customer
          </button>
          {customerOpen ? (
            <div className="relative">
              <input
                value={customerQuery}
                onChange={(event) => setCustomerQuery(event.target.value)}
                placeholder="Search a customer"
                aria-label="Search a customer"
                className="h-9 w-44 rounded-md border border-border px-2 text-sm"
              />
              {customerMatches.length > 0 ? (
                <ul className="absolute z-20 mt-1 w-56 rounded-md border border-border bg-white p-1 shadow-md">
                  {customerMatches.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="flex w-full justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-secondary"
                        onClick={() => {
                          setCustomerId(item.id);
                          setCustomerQuery("");
                          setCustomerOpen(false);
                        }}
                      >
                        <span>{item.name}</span>
                        <span className="text-muted">{item.phone}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <Link href="/customers/new" className="inline-flex h-9 items-center rounded-md bg-[#20c997] px-3 text-sm font-semibold text-white">
            Add Customer
          </Link>
          <button type="button" className="h-9 rounded-md bg-[#f0ad4e] px-3 text-sm font-semibold text-white disabled:opacity-60" disabled={pending || cart.length === 0} onClick={() => submit(true)}>
            Hold
          </button>
          <button type="button" className="h-9 rounded-md bg-[#6c757d] px-3 text-sm font-semibold text-white" onClick={clearSale}>
            Clear
          </button>
          <Link href="/sales/returns" className="inline-flex h-9 items-center rounded-md bg-[#7c4dff] px-3 text-sm font-semibold text-white">
            Exchange
          </Link>
          <button type="button" className="h-9 rounded-md bg-[#e74c3c] px-3 text-sm font-semibold text-white" onClick={() => window.location.reload()}>
            Refresh
          </button>
          <Link href="/dashboard" className="inline-flex h-9 items-center rounded-md bg-[#1f9d55] px-3 text-sm font-semibold text-white">
            Dashboard
          </Link>
        </div>
      </div>
      <div className="grid min-h-[32rem] lg:grid-cols-[240px_minmax(0,1fr)_230px]">
        <aside className="border-b border-border bg-white p-3 lg:border-r lg:border-b-0">
          <select aria-label="Category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className={selectClass}>
            <option value="">Category</option>
            {categories.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
          <select aria-label="Brand" value={brandId} onChange={(event) => setBrandId(event.target.value)} className={`${selectClass} mt-2`}>
            <option value="">Brands</option>
            {brands.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
          <div className="mt-2 flex gap-1">
            <input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Product Name" aria-label="Product name" className="h-9 min-w-0 flex-1 rounded-md border border-border px-2 text-sm" />
            <button type="button" aria-label="Clear product search" className="h-9 rounded-md bg-[#1f9d55] px-3 font-semibold text-white" onClick={() => setProductQuery("")}>
              X
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {shelf.map((product) => (
              <button key={product.id} type="button" onClick={() => addProduct(product)} className="rounded-md border border-border bg-white p-2 text-left hover:border-[#1f9d55]">
                {product.hasImage ? (
                  <img src={`/api/v1/products/${product.id}/image`} alt="" className="mx-auto h-16 w-full rounded object-contain" />
                ) : (
                  <span className="mx-auto flex h-16 items-center justify-center rounded bg-[#e7eef8] text-xs text-muted">Photo</span>
                )}
                <span className="mt-1 block truncate text-xs">{product.name}</span>
                <span className="block text-xs font-semibold text-[#3b6fd8]">{product.sellingPrice} Tk</span>
                <span className="block text-[11px] text-muted">Stock:{product.stock}</span>
              </button>
            ))}
          </div>
        </aside>
        <section className="bg-white">
          <p className="border-b border-border px-3 py-2 text-sm">
            {customer ? `${customer.name} · ${customer.phone ?? ""}` : "Walking Customer"}
            {advance > zero ? ` · Advance ${money(advance)}` : ""}
          </p>
          <div className="border-b border-border p-2">
            <input
              ref={barcodeRef}
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addBarcode();
                }
              }}
              placeholder="Scan barcode"
              aria-label="Barcode"
              autoFocus
              className="h-10 w-full rounded-md border border-border px-3 text-sm"
            />
          </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#123a63] text-left text-xs text-white">
                <th className="px-3 py-2 font-medium">Product Info</th>
                <th className="py-2 font-medium">Quantity</th>
                <th className="py-2 font-medium">Subtotal</th>
                <th className="py-2 font-medium">X</th>
              </tr>
            </thead>
            <tbody>
              {cart.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-16 text-center text-muted">
                    Scan a barcode or choose a product.
                  </td>
                </tr>
              ) : (
                cart.map((line, index) => (
                  <tr key={line.productId} className="border-b border-border">
                    <td className="py-2">
                      <span className="block font-medium">{line.name}</span>
                      <span className="text-xs text-muted">{line.sku}</span>
                      {canOverride ? (
                        <input
                          aria-label={`Price for ${line.name}`}
                          value={line.unitPrice}
                          onChange={(event) =>
                            setCart((current) => current.map((item) => (item.productId === line.productId ? { ...item, unitPrice: event.target.value } : item)))
                          }
                          className="mt-1 h-8 w-24 rounded-md border border-border px-2"
                        />
                      ) : (
                        <span className="block text-xs">{line.unitPrice}</span>
                      )}
                      {line.trackSerial ? (
                        <input
                          aria-label={`IMEI for ${line.name}`}
                          value={line.serial}
                          placeholder="IMEI"
                          onChange={(event) =>
                            setCart((current) => current.map((item) => (item.productId === line.productId ? { ...item, serial: event.target.value } : item)))
                          }
                          className="mt-1 h-9 w-40 rounded-md border border-border px-2"
                        />
                      ) : null}
                    </td>
                    <td className="py-2">
                      <input
                        aria-label={`Quantity for ${line.name}`}
                        value={line.trackSerial ? "1" : line.quantity}
                        readOnly={line.trackSerial}
                        onChange={(event) =>
                          setCart((current) => current.map((item) => (item.productId === line.productId ? { ...item, quantity: event.target.value } : item)))
                        }
                        className="h-9 w-24 rounded-md border border-border px-2"
                      />
                    </td>
                    <td className="py-2">{money(priced[index]?.payable ?? zero)}</td>
                    <td className="py-2">
                      <button type="button" className="text-error" aria-label={`Remove ${line.name}`} onClick={() => setCart((current) => current.filter((item) => item.productId !== line.productId))}>
                        X
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      <aside className="border-t border-border bg-white p-3 lg:border-t-0 lg:border-l">
        <Summary label="Total Gross" value={money(gross)} />
        <label className="mt-2 flex items-center justify-between gap-2 text-sm">
          <span>Discount (F6)</span>
          <input
            ref={discountRef}
            aria-label="Discount"
            value={discountText}
            disabled={!canDiscount}
            onChange={(event) => {
              setCashEdited(false);
              setDiscountText(event.target.value);
            }}
            className="h-8 w-20 rounded-md border border-border px-2 text-right disabled:bg-secondary"
          />
        </label>
        <label className="mt-2 flex items-center justify-between gap-2 text-sm">
          <span>Others</span>
          <input
            ref={chargesRef}
            aria-label="Other charges"
            value={chargesText}
            onChange={(event) => {
              setCashEdited(false);
              setChargesText(event.target.value);
            }}
            className="h-8 w-20 rounded-md border border-border px-2 text-right"
          />
        </label>
        <Summary label="Sub Total" value={money(subtotal)} />
        {vatTotal > zero ? <p className="text-right text-[11px] text-muted">VAT {money(vatTotal)}</p> : null}
        <div className="mt-2 flex items-center justify-between rounded-md bg-[#e74c3c] px-2 py-1 text-sm font-semibold text-white">
          <span>Previous Due</span>
          <span>{money(previousDue)}</span>
        </div>
        <Summary label="Total Payable" value={totalText} strong />
        {change !== null && change > zero ? <p className="text-right text-xs text-muted">Change {money(change)}</p> : null}
        <label className="mt-3 grid gap-1 text-sm">
          Paid
          <input
            aria-label="Cash paid"
            value={cashText}
            onChange={(event) => {
              setCashEdited(true);
              setCash(event.target.value);
            }}
            className="h-9 rounded-md border border-border px-2 text-right"
          />
        </label>
        <p className="mt-2 text-right text-sm">Current due {due === null ? "—" : money(due)}</p>
        {shownMessage ? <p role="alert" className="mt-2 text-sm text-error">{shownMessage}</p> : null}
        <button type="submit" disabled={pending || cart.length === 0} className="mt-3 h-10 w-full rounded-full bg-[#7c4dff] text-sm font-semibold text-white disabled:opacity-60">
          Cash F9
        </button>
        <button type="button" disabled={pending || cart.length === 0} className="mt-2 h-10 w-full rounded-full bg-[#123a63] text-sm font-semibold text-white disabled:opacity-60" onClick={() => submit(false, "CARD")}>
          MFS or Card
        </button>
        <button type="button" className="mt-2 h-10 w-full rounded-full bg-[#f0ad4e] text-sm font-semibold text-white" onClick={() => setExtraPay((open) => !open)}>
          Multiple Pay
        </button>
        {extraPay ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" disabled={pending || cart.length === 0} className="h-9 rounded-md border border-border text-sm" onClick={() => submit(false, "BANK")}>
              Bank
            </button>
            <button type="button" disabled={pending || cart.length === 0} className="h-9 rounded-md border border-border text-sm" onClick={() => submit(false, "WALLET")}>
              Wallet
            </button>
          </div>
        ) : null}
        <p className="mt-2 text-[11px] text-muted">Previous due is not collected here. Extra cash is change and is not posted.</p>
      </aside>
      </div>
    </form>
  );
}

function Summary({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`mt-2 flex items-center justify-between text-sm ${strong ? "text-base font-semibold" : ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function CustomerForm() {
  const { submit, pending, message } = useSubmit();

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const element = event.currentTarget;
        const form = new FormData(element);
        void submit(
          { url: "/api/v1/customers", body: { name: form.get("name"), creditLimit: String(form.get("creditLimit") || "") || undefined } },
          { successMessage: "কাস্টমার যোগ হয়েছে। (Customer added.)", onSuccess: () => element.reset() },
        );
      }}
    >
      <Input name="name" required placeholder="Customer name" aria-label="Customer name" />
      <Input name="creditLimit" placeholder="Credit limit" aria-label="Credit limit" />
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" variant="secondary" loading={pending}>
        Add customer
      </Button>
    </form>
  );
}
