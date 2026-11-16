import type { ReactNode } from "react";

import { APP_NAME } from "@/constants/app";
import { getSession } from "@/modules/auth/current-session";
import { getOrganizationProfile } from "@/modules/settings/profile";

type Party = { label: string; name: string; lines?: Array<string | null | undefined> };
type Meta = { label: string; value: string };

/**
 * A printed document (invoice, receipt, quotation, purchase order, voucher, statement): the shop's own header (logo, name, address, phone,
 * BIN/TIN), the document's title, number and date, who it is for, the body, signatures and a footer. Found by the 16-day user test: the
 * printed papers carried the software's name instead of the shop's, and no address, phone or BIN.
 * On A4 the header is two columns; on an 80 mm roll (`thermal`) everything is centred and compact.
 */
export async function PrintSheet({
  title,
  note,
  thermal = false,
  meta = [],
  party,
  signatures,
  footer,
  children,
}: {
  title: string;
  note?: string;
  thermal?: boolean;
  /** Number, date, time, sold by ...: shown beside the title. */
  meta?: Meta[];
  party?: Party;
  /** Labels of the signature lines at the foot (A4 only), e.g. customer and authorised. */
  signatures?: string[];
  footer?: ReactNode;
  children: ReactNode;
}) {
  const session = await getSession();
  const shop = session ? await getOrganizationProfile(session.organizationId) : null;
  const name = shop?.name || APP_NAME;
  const ids = [shop?.bin ? `BIN ${shop.bin}` : "", shop?.tin ? `TIN ${shop.tin}` : ""].filter(Boolean).join(" · ");
  const printedAt = new Date().toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  if (thermal) {
    return (
      <article className="print-sheet thermal mx-auto max-w-xs rounded-md border border-border bg-white p-3 text-[12px] leading-snug text-black">
        <header className="text-center">
          {shop?.logoUrl ? <img src={shop.logoUrl} alt="" className="mx-auto mb-1 h-10 w-auto" /> : null}
          <p className="text-base font-bold">{name}</p>
          {shop?.address ? <p>{shop.address}</p> : null}
          {shop?.phone ? <p>{shop.phone}</p> : null}
          {ids ? <p>{ids}</p> : null}
          <p className="mt-1 border-y border-dashed border-black py-0.5 font-semibold uppercase tracking-wide">{title}</p>
        </header>
        {meta.length > 0 ? (
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2">
            {meta.map((row) => (
              <div key={row.label} className="contents">
                <dt>{row.label}</dt>
                <dd className="text-right">{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {party ? (
          <p className="mt-1">
            {party.label}: <span className="font-semibold">{party.name}</span>
            {party.lines?.filter(Boolean).map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </p>
        ) : null}
        {note ? <p className="mt-1">{note}</p> : null}
        <div className="mt-2 space-y-1 border-t border-dashed border-black pt-1">{children}</div>
        {footer ? <div className="mt-2 border-t border-dashed border-black pt-1 text-center">{footer}</div> : null}
        <p className="mt-2 text-center text-[10px]">
          {printedAt} · {APP_NAME}
        </p>
      </article>
    );
  }

  return (
    <article className="print-sheet rounded-md border border-border bg-white p-6 text-black">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-black pb-3">
        <div className="flex items-start gap-3">
          {shop?.logoUrl ? <img src={shop.logoUrl} alt="" className="h-14 w-auto" /> : null}
          <div>
            <p className="text-xl font-bold leading-tight">{name}</p>
            {shop?.address ? <p className="text-sm">{shop.address}</p> : null}
            {shop?.phone ? <p className="text-sm">{shop.phone}</p> : null}
            {ids ? <p className="text-xs">{ids}</p> : null}
          </div>
        </div>
        <div className="text-right">
          <h2 className="text-2xl font-bold uppercase tracking-wide">{title}</h2>
          {meta.length > 0 ? (
            <dl className="mt-1 grid grid-cols-[auto_auto] justify-end gap-x-3 text-sm">
              {meta.map((row) => (
                <div key={row.label} className="contents">
                  <dt className="text-gray-600">{row.label}</dt>
                  <dd className="font-medium">{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </header>
      {party || note ? (
        <section className="mt-3 flex flex-wrap justify-between gap-4 text-sm">
          {party ? (
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-600">{party.label}</p>
              <p className="font-semibold">{party.name}</p>
              {party.lines?.filter(Boolean).map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ) : null}
          {note ? <p className="max-w-md text-right">{note}</p> : null}
        </section>
      ) : null}
      <div className="mt-4 space-y-3 text-sm">{children}</div>
      {footer ? <div className="mt-4 text-sm">{footer}</div> : null}
      {signatures && signatures.length > 0 ? (
        <div className="mt-12 flex justify-between gap-8 text-sm">
          {signatures.map((label) => (
            <p key={label} className="min-w-40 border-t border-black pt-1 text-center">
              {label}
            </p>
          ))}
        </div>
      ) : null}
      <p className="mt-6 border-t border-gray-300 pt-1 text-center text-[10px] text-gray-600">
        {printedAt} · {APP_NAME}
      </p>
    </article>
  );
}
