"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

// A courier: its phone, the condition percentage it keeps of the cash it collects, and what it charges to deliver, inside Dhaka and outside.
// What is here is the default; each shipment may change it.

export type CourierValues = { id?: string; name: string; phone: string; status: "ACTIVE" | "INACTIVE"; defaultConditionPercent: string; defaultDeliveryCharge: string; outsideDeliveryCharge: string };

export function CourierForm({ initial }: { initial?: CourierValues }) {
  const { submit, pending, message, reset } = useSubmit();
  const [values, setValues] = useState<CourierValues>(initial ?? { name: "", phone: "", status: "ACTIVE", defaultConditionPercent: "1", defaultDeliveryCharge: "60", outsideDeliveryCharge: "110" });
  const set = (name: keyof CourierValues, value: string) => setValues((current) => ({ ...current, [name]: value }));

  return (
    <form
      className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(
          { url: initial?.id ? `/api/v1/couriers/${initial.id}` : "/api/v1/couriers", method: initial?.id ? "PATCH" : "POST", body: { name: values.name, phone: values.phone || undefined, status: values.status, defaultConditionPercent: values.defaultConditionPercent, defaultDeliveryCharge: values.defaultDeliveryCharge, outsideDeliveryCharge: values.outsideDeliveryCharge } },
          { successMessage: "কুরিয়ার সংরক্ষিত হয়েছে। (Courier saved.)", onSuccess: () => { if (!initial) { setValues({ name: "", phone: "", status: "ACTIVE", defaultConditionPercent: "1", defaultDeliveryCharge: "60", outsideDeliveryCharge: "110" }); reset(); } } },
        );
      }}
    >
      <label className="grid gap-1 text-sm md:col-span-2">
        Name
        <Input value={values.name} onChange={(event) => set("name", event.target.value)} required maxLength={191} />
      </label>
      <label className="grid gap-1 text-sm">
        Phone
        <Input value={values.phone} onChange={(event) => set("phone", event.target.value)} maxLength={32} />
      </label>
      <label className="grid gap-1 text-sm">
        Condition %
        <Input inputMode="decimal" value={values.defaultConditionPercent} onChange={(event) => set("defaultConditionPercent", event.target.value)} />
      </label>
      <label className="grid gap-1 text-sm">
        Delivery, Dhaka
        <Input inputMode="decimal" value={values.defaultDeliveryCharge} onChange={(event) => set("defaultDeliveryCharge", event.target.value)} />
      </label>
      <label className="grid gap-1 text-sm">
        Delivery, outside
        <Input inputMode="decimal" value={values.outsideDeliveryCharge} onChange={(event) => set("outsideDeliveryCharge", event.target.value)} />
      </label>
      {initial ? (
        <label className="flex items-center gap-2 text-sm md:col-span-3">
          <input type="checkbox" checked={values.status === "ACTIVE"} onChange={(event) => setValues((current) => ({ ...current, status: event.target.checked ? "ACTIVE" : "INACTIVE" }))} />
          In use
        </label>
      ) : null}
      {message ? <p className="text-sm text-error md:col-span-6" role="alert">{message}</p> : null}
      <div className="md:col-span-6">
        <Button type="submit" size="sm" loading={pending}>
          {initial ? "Save" : "Add courier"}
        </Button>
      </div>
    </form>
  );
}
