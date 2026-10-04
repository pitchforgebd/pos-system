"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { MoneyDisplay } from "@/components/ui/money-display";
import { Modal } from "@/components/ui/modal";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";

type PosProduct = {
  id: string;
  name: string;
  price: number;
  category: string;
  barcode: string;
};

const products: PosProduct[] = [
  { id: "GT-500", name: "Green tea 500g", price: 240, category: "Beverages", barcode: "8941001000011" },
  { id: "RC-5", name: "Basmati rice 5kg", price: 820, category: "Grocery", barcode: "8941001000018" },
  { id: "OL-2", name: "Sunflower oil 2L", price: 380, category: "Grocery", barcode: "8941001000025" },
  { id: "MP-1", name: "Milk powder 1kg", price: 690, category: "Grocery", barcode: "8941001000032" },
  { id: "SP-200", name: "Soap 200g", price: 55, category: "Personal care", barcode: "8941001000049" },
  { id: "HW-1", name: "Honey 500g", price: 540, category: "Grocery", barcode: "8941001000056" },
];

const categories = ["All", ...new Set(products.map((product) => product.category))];

type CartLine = { product: PosProduct; quantity: number };

export function PosScreen() {
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [customer, setCustomer] = useState("Walk-in customer");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [held, setHeld] = useState(0);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory = category === "All" || product.category === category;
      const matchesQuery = needle.length === 0 || product.name.toLowerCase().includes(needle) || product.barcode.includes(needle);
      return matchesCategory && matchesQuery;
    });
  }, [category, query]);

  const previewTotal = cart.reduce((sum, line) => sum + line.product.price * line.quantity, 0);

  function addProduct(product: PosProduct) {
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (!existing) {
        return [...current, { product, quantity: 1 }];
      }
      return current.map((line) => (line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line));
    });
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "F2") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "F4") {
        event.preventDefault();
        document.getElementById("pos-customer")?.focus();
      }
      if (event.key === "F6") {
        event.preventDefault();
        if (cart.length > 0) {
          setHeld((count) => count + 1);
          setCart([]);
          setNote("Ticket held in this browser only.");
        }
      }
      if (event.key === "F8") {
        event.preventDefault();
        setPaymentOpen(true);
      }
      if (event.key === "F9") {
        event.preventDefault();
        document.getElementById("pos-discount")?.focus();
      }
      if (event.key === "F10") {
        event.preventDefault();
        setConfirmOpen(true);
      }
      if (event.key === "Escape") {
        setPaymentOpen(false);
        setConfirmOpen(false);
      }
      if (event.key === "Enter" && event.ctrlKey) {
        event.preventDefault();
        setConfirmOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cart.length]);

  return (
    <div className="space-y-4">
      <Alert tone="info" title="Sample register">
        Preview total is price times quantity for this layout. It is not a posted sale.
      </Alert>
      {note ? <Alert tone="success" title={note} /> : null}
      <p className="text-xs text-muted">F2 search, F4 customer, F6 hold, F8 payment, F9 discount, F10 complete, Esc close.</p>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="space-y-3">
          <SearchInput ref={searchRef} value={query} placeholder="Name or barcode" aria-label="Search sample products" onChange={(event) => setQuery(event.target.value)} />
          <div className="flex gap-2 overflow-x-auto">
            {categories.map((item) => (
              <Button key={item} variant={item === category ? "primary" : "secondary"} size="sm" onClick={() => setCategory(item)}>
                {item}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {visible.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => addProduct(product)}
                className="rounded-md border border-border bg-surface p-3 text-left hover:bg-secondary"
              >
                <span className="block text-sm font-medium">{product.name}</span>
                <span className="mt-2 block text-sm text-muted">
                  <MoneyDisplay amount={product.price} />
                </span>
              </button>
            ))}
          </div>
        </section>
        <aside className="space-y-3 rounded-md border border-border bg-surface p-4">
          <FormField label="Customer" htmlFor="pos-customer">
            <Select id="pos-customer" value={customer} onChange={(event) => setCustomer(event.target.value)}>
              <option>Walk-in customer</option>
              <option>City Grocers</option>
              <option>North Wharf Store</option>
            </Select>
          </FormField>
          <ul className="divide-y divide-border">
            {cart.length === 0 ? <li className="py-6 text-sm text-muted">Cart is empty.</li> : null}
            {cart.map((line) => (
              <li key={line.product.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span>
                  {line.product.name}
                  <span className="block text-xs text-muted">
                    <MoneyDisplay amount={line.product.price * line.quantity} />
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setCart((current) =>
                        current
                          .map((item) => (item.product.id === line.product.id ? { ...item, quantity: item.quantity - 1 } : item))
                          .filter((item) => item.quantity > 0),
                      )
                    }
                  >
                    −
                  </Button>
                  <span className="w-6 text-center tabular-nums">{line.quantity}</span>
                  <Button variant="secondary" size="sm" onClick={() => addProduct(line.product)}>
                    +
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          <FormField label="Discount preview" htmlFor="pos-discount" hint="Not applied to the preview total.">
            <Input id="pos-discount" inputMode="decimal" placeholder="0.00" />
          </FormField>
          <p className="flex items-center justify-between text-sm font-semibold">
            Preview total <MoneyDisplay amount={previewTotal} />
          </p>
          <p className="text-xs text-muted">Held here: {held}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setPaymentOpen(true)}>
              Payment
            </Button>
            <Button onClick={() => setConfirmOpen(true)}>Complete sale</Button>
          </div>
        </aside>
      </div>
      <Modal open={paymentOpen} onOpenChange={setPaymentOpen} title="Payment preview" description="Tender is not collected.">
        <div className="space-y-3">
          <FormField label="Cash" htmlFor="pay-cash">
            <Input id="pay-cash" inputMode="decimal" />
          </FormField>
          <FormField label="Card" htmlFor="pay-card">
            <Input id="pay-card" inputMode="decimal" />
          </FormField>
          <FormField label="Due" htmlFor="pay-due">
            <Input id="pay-due" inputMode="decimal" />
          </FormField>
          <div className="flex justify-end">
            <Button
              onClick={() => {
                setPaymentOpen(false);
                setNote("Payment was not collected.");
              }}
            >
              Close
            </Button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Complete this sale?"
        description="The cart stays on this screen. No invoice, stock change, or journal is created."
        confirmLabel="Keep as preview"
        onConfirm={() => setNote("Sale was not saved.")}
      />
    </div>
  );
}
