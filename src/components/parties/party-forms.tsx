"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useSubmit } from "@/lib/client/use-submit";
import { useI18n } from "@/lib/i18n/provider";


// The customer and vendor forms (P10 tasks 2-3): a Bangladeshi phone (a number another customer already has is a warning, not a refusal), where
// they are (division -> district, required -> upazila, D15), and for a customer the type (its price level), credit, payment days, tags and SMS.

export type Places = {
  divisions: Array<{ id: number; name: string; bnName: string }>;
  districts: Array<{ id: number; divisionId: number; name: string; bnName: string }>;
  upazilas: Array<{ id: number; districtId: number; name: string; bnName: string }>;
};
type Option = { id: string; label: string };

const both = (row: { name: string; bnName: string }) => `${row.name} (${row.bnName})`;
const text = (data: FormData, name: string) => String(data.get(name) ?? "").trim() || null;
const number = (data: FormData, name: string) => {
  const value = String(data.get(name) ?? "").trim();
  return value === "" ? null : Number(value);
};

/** Division, then district (required), then upazila (optional). */
export function PlacePicker({ places, districtId, upazilaId }: { places: Places; districtId?: number | null; upazilaId?: number | null }) {
  const { ph } = useI18n();
  const start = places.districts.find((row) => row.id === districtId);
  const [division, setDivision] = useState<number | "">(start?.divisionId ?? "");
  const [district, setDistrict] = useState<number | "">(start?.id ?? "");
  const [upazila, setUpazila] = useState<number | "">(upazilaId ?? "");
  const districts = places.districts.filter((row) => division === "" || row.divisionId === division);
  const upazilas = district === "" ? [] : places.upazilas.filter((row) => row.districtId === district);
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="grid gap-1 text-sm">
        {ph("Division")}
        <Select
          value={division === "" ? "" : String(division)}
          onChange={(event) => {
            setDivision(event.target.value === "" ? "" : Number(event.target.value));
            setDistrict("");
            setUpazila("");
          }}
          aria-label={ph("Division")}
        >
          <option value="">{ph("All divisions")}</option>
          {places.divisions.map((row) => (
            <option key={row.id} value={row.id}>
              {both(row)}
            </option>
          ))}
        </Select>
      </label>
      <label className="grid gap-1 text-sm">
        {ph("District")}
        <Select
          name="districtId"
          required
          value={district === "" ? "" : String(district)}
          onChange={(event) => {
            const value = event.target.value === "" ? "" : Number(event.target.value);
            setDistrict(value);
            setUpazila("");
            if (value !== "") {
              setDivision(places.districts.find((row) => row.id === value)?.divisionId ?? "");
            }
          }}
          aria-label={ph("District")}
        >
          <option value="" disabled>
            {ph("Choose the district")}
          </option>
          {districts.map((row) => (
            <option key={row.id} value={row.id}>
              {both(row)}
            </option>
          ))}
        </Select>
      </label>
      <label className="grid gap-1 text-sm">
        {ph("Upazila")}
        <Select name="upazilaId" value={upazila === "" ? "" : String(upazila)} onChange={(event) => setUpazila(event.target.value === "" ? "" : Number(event.target.value))} aria-label={ph("Upazila")} disabled={district === ""}>
          <option value="">{ph("Not given")}</option>
          {upazilas.map((row) => (
            <option key={row.id} value={row.id}>
              {both(row)}
            </option>
          ))}
        </Select>
      </label>
    </div>
  );
}

/** A phone field that says, as soon as the number is typed, who else already has it. */
function PhoneField({ kind, name, label, defaultValue, exceptId, required = false }: { kind: "customers" | "suppliers"; name: string; label: string; defaultValue?: string | null; exceptId?: string; required?: boolean }) {
  const { ph } = useI18n();
  const [value, setValue] = useState(defaultValue ?? "");
  const [found, setFound] = useState<{ phone: string; names: string[] }>({ phone: "", names: [] });
  const typed = value.replace(/[\s()-]/g, "");
  useEffect(() => {
    if (!/^(\+?880|0)1[3-9]\d{8}$/.test(typed)) {
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`/api/v1/${kind}/same-phone?phone=${encodeURIComponent(typed)}${exceptId ? `&except=${exceptId}` : ""}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { data?: Array<{ code: string; name: string }> } | null) => setFound({ phone: typed, names: (body?.data ?? []).map((row) => `${row.name} (${row.code})`) }))
        .catch(() => undefined);
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [typed, kind, exceptId]);
  const others = found.phone === typed ? found.names : [];
  return (
    <label className="grid gap-1 text-sm">
      {label}
      <Input name={name} value={value} onChange={(event) => setValue(event.target.value)} required={required} inputMode="tel" placeholder={ph("01XXXXXXXXX")} aria-label={label} />
      {others.length > 0 ? <span className="text-xs text-warning">{ph("Already used by")} {others.join(", ")}{ph(". You can still save.")}</span> : null}
    </label>
  );
}

export type CustomerInitial = {
  id: string;
  code: string;
  name: string;
  businessName: string | null;
  phone: string | null;
  altPhone: string | null;
  email: string | null;
  address: string | null;
  nid: string | null;
  districtId: number | null;
  upazilaId: number | null;
  customerTypeId: string | null;
  creditLimit: string | null;
  paymentDays: number | null;
  paymentTerms: string | null;
  tags: string | null;
  smsOptOut: boolean;
  status: "ACTIVE" | "INACTIVE";
  openingBalance: string;
};

/** Adds a customer (no initial) or changes one. */
export function CustomerForm({ types, places, initial }: { types: Option[]; places: Places; initial?: CustomerInitial }) {
  const { ph } = useI18n();
  const { submit, pending, message } = useSubmit();
  return (
    <form
      className="grid max-w-3xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const body = {
          name: data.get("name"),
          businessName: text(data, "businessName"),
          phone: text(data, "phone"),
          altPhone: text(data, "altPhone"),
          email: text(data, "email"),
          address: text(data, "address"),
          nid: text(data, "nid"),
          districtId: number(data, "districtId"),
          upazilaId: number(data, "upazilaId"),
          customerTypeId: text(data, "customerTypeId"),
          creditLimit: text(data, "creditLimit"),
          paymentDays: number(data, "paymentDays"),
          paymentTerms: text(data, "paymentTerms"),
          tags: text(data, "tags"),
          smsOptOut: data.get("smsOptOut") === "on",
        };
        if (initial) {
          void submit({ url: `/api/v1/customers/${initial.id}`, method: "PATCH", body: { ...body, status: data.get("status") } });
        } else {
          void submit<{ id: string }>({ url: "/api/v1/customers", body: { ...body, openingBalance: String(data.get("openingBalance") || "0.00") } }, { goTo: (customer) => `/customers/${customer.id}` });
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          {ph("Name")}
          <Input name="name" required maxLength={191} defaultValue={initial?.name} />
        </label>
        <label className="grid gap-1 text-sm">
          {ph("Business name")}
          <Input name="businessName" maxLength={191} defaultValue={initial?.businessName ?? ""} />
        </label>
        <PhoneField kind="customers" name="phone" label={ph("Phone")} defaultValue={initial?.phone} exceptId={initial?.id} />
        <PhoneField kind="customers" name="altPhone" label={ph("Other phone")} defaultValue={initial?.altPhone} exceptId={initial?.id} />
      </div>
      <PlacePicker places={places} districtId={initial?.districtId} upazilaId={initial?.upazilaId} />
      <label className="grid gap-1 text-sm">
        {ph("Address")}
        <Input name="address" maxLength={255} defaultValue={initial?.address ?? ""} placeholder={ph("Village / road, house")} />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-sm">
          {ph("Type (its price level)")}
          <Select name="customerTypeId" defaultValue={initial?.customerTypeId ?? ""}>
            <option value="">{ph("No type (the default prices)")}</option>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-sm">
          {ph("Credit limit")}
          <Input name="creditLimit" inputMode="decimal" defaultValue={initial?.creditLimit ?? ""} placeholder={ph("No limit")} />
        </label>
        <label className="grid gap-1 text-sm">
          {ph("Days to pay")}
          <Input name="paymentDays" type="number" min={0} max={365} defaultValue={initial?.paymentDays ?? ""} placeholder="0" />
        </label>
        <label className="grid gap-1 text-sm">
          {ph("Email")}
          <Input name="email" type="email" defaultValue={initial?.email ?? ""} />
        </label>
        <label className="grid gap-1 text-sm">
          {ph("National ID")}
          <Input name="nid" inputMode="numeric" maxLength={17} defaultValue={initial?.nid ?? ""} />
        </label>
        <label className="grid gap-1 text-sm">
          {ph("Payment terms (note)")}
          <Input name="paymentTerms" maxLength={64} defaultValue={initial?.paymentTerms ?? ""} />
        </label>
      </div>
      <label className="grid gap-1 text-sm">
        {ph("Tags (comma separated)")}
        <Input name="tags" maxLength={255} defaultValue={initial?.tags ?? ""} placeholder={ph("dealer, rice, regular")} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="smsOptOut" defaultChecked={initial?.smsOptOut ?? false} /> {ph("Does not want offer or reminder SMS")}
      </label>
      {initial ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm">
            {ph("Status")}
            <Select name="status" defaultValue={initial.status}>
              <option value="ACTIVE">{ph("Active")}</option>
              <option value="INACTIVE">{ph("Inactive")}</option>
            </Select>
          </label>
          <p className="text-sm text-muted">
            {ph("Code")} {initial.code}{ph(". Opening balance")} {initial.openingBalance} {ph("is not edited here.")}
          </p>
        </div>
      ) : (
        <label className="grid max-w-xs gap-1 text-sm">
          {ph("What they owed before (opening balance)")}
          <Input name="openingBalance" inputMode="decimal" defaultValue="0.00" />
        </label>
      )}
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        {initial ? ph("Save customer") : ph("Add customer")}
      </Button>
    </form>
  );
}

export type VendorInitial = {
  id: string;
  code: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  altPhone: string | null;
  email: string | null;
  address: string | null;
  districtId: number | null;
  upazilaId: number | null;
  bankDetails: string | null;
  creditLimit: string | null;
  paymentDays: number | null;
  paymentTerms: string | null;
  status: "ACTIVE" | "INACTIVE";
};

/** Adds a vendor (no initial) or changes one. */
export function VendorForm({ places, initial }: { places: Places; initial?: VendorInitial }) {
  const { ph } = useI18n();
  const { submit, pending, message } = useSubmit();
  return (
    <form
      className="grid max-w-3xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const body = {
          name: data.get("name"),
          contactPerson: text(data, "contactPerson"),
          phone: text(data, "phone"),
          altPhone: text(data, "altPhone"),
          email: text(data, "email"),
          address: text(data, "address"),
          districtId: number(data, "districtId"),
          upazilaId: number(data, "upazilaId"),
          bankDetails: text(data, "bankDetails"),
          creditLimit: text(data, "creditLimit"),
          paymentDays: number(data, "paymentDays"),
          paymentTerms: text(data, "paymentTerms"),
        };
        if (initial) {
          void submit({ url: `/api/v1/suppliers/${initial.id}`, method: "PATCH", body: { ...body, status: data.get("status") } });
        } else {
          void submit<{ id: string }>({ url: "/api/v1/suppliers", body: { ...body, openingPayable: String(data.get("openingPayable") || "0.00") } }, { goTo: (vendor) => `/suppliers/${vendor.id}` });
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          {ph("Name")}
          <Input name="name" required maxLength={191} defaultValue={initial?.name} />
        </label>
        <label className="grid gap-1 text-sm">
          {ph("Contact person")}
          <Input name="contactPerson" maxLength={191} defaultValue={initial?.contactPerson ?? ""} />
        </label>
        <PhoneField kind="suppliers" name="phone" label={ph("Phone")} defaultValue={initial?.phone} exceptId={initial?.id} />
        <PhoneField kind="suppliers" name="altPhone" label={ph("Other phone")} defaultValue={initial?.altPhone} exceptId={initial?.id} />
      </div>
      <PlacePicker places={places} districtId={initial?.districtId} upazilaId={initial?.upazilaId} />
      <label className="grid gap-1 text-sm">
        {ph("Address")}
        <Input name="address" maxLength={255} defaultValue={initial?.address ?? ""} />
      </label>
      <label className="grid gap-1 text-sm">
        {ph("Bank details (bank, branch, account)")}
        <Input name="bankDetails" maxLength={255} defaultValue={initial?.bankDetails ?? ""} />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-sm">
          {ph("Email")}
          <Input name="email" type="email" defaultValue={initial?.email ?? ""} />
        </label>
        <label className="grid gap-1 text-sm">
          {ph("Credit limit")}
          <Input name="creditLimit" inputMode="decimal" defaultValue={initial?.creditLimit ?? ""} placeholder={ph("No limit")} />
        </label>
        <label className="grid gap-1 text-sm">
          {ph("Days to pay")}
          <Input name="paymentDays" type="number" min={0} max={365} defaultValue={initial?.paymentDays ?? ""} />
        </label>
      </div>
      <label className="grid gap-1 text-sm">
        {ph("Payment terms (note)")}
        <Input name="paymentTerms" maxLength={64} defaultValue={initial?.paymentTerms ?? ""} />
      </label>
      {initial ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm">
            {ph("Status")}
            <Select name="status" defaultValue={initial.status}>
              <option value="ACTIVE">{ph("Active")}</option>
              <option value="INACTIVE">{ph("Inactive")}</option>
            </Select>
          </label>
          <p className="text-sm text-muted">{ph("Code")} {initial.code}.</p>
        </div>
      ) : (
        <label className="grid max-w-xs gap-1 text-sm">
          {ph("What the shop owed them before (opening payable)")}
          <Input name="openingPayable" inputMode="decimal" defaultValue="0.00" />
        </label>
      )}
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        {initial ? ph("Save vendor") : ph("Add vendor")}
      </Button>
    </form>
  );
}

/** The register's quick add: name, phone and district (D15), the rest later on the customer's page. */
export function QuickCustomerForm({ places }: { places: Places }) {
  const { submit, pending, message } = useSubmit();
  const { t } = useI18n();
  const [district, setDistrict] = useState("");
  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const element = event.currentTarget;
        const data = new FormData(element);
        void submit(
          { url: "/api/v1/customers", body: { name: data.get("name"), phone: text(data, "phone"), districtId: number(data, "districtId"), creditLimit: text(data, "creditLimit") } },
          {
            successMessage: t("customers.quickDone"),
            onSuccess: () => {
              element.reset();
              setDistrict("");
            },
          },
        );
      }}
    >
      <Input name="name" required placeholder={t("customers.quickName")} aria-label={t("customers.quickName")} />
      <PhoneField kind="customers" name="phone" label={t("customers.quickPhone")} />
      <Select name="districtId" required value={district} onChange={(event) => setDistrict(event.target.value)} aria-label={t("customers.quickDistrict")}>
        <option value="" disabled>
          {t("customers.quickDistrict")}
        </option>
        {places.districts.map((row) => (
          <option key={row.id} value={row.id}>
            {both(row)}
          </option>
        ))}
      </Select>
      <Input name="creditLimit" placeholder={t("customers.quickLimit")} aria-label={t("customers.quickLimit")} />
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" variant="secondary" loading={pending}>
        {t("customers.quickAdd")}
      </Button>
    </form>
  );
}
