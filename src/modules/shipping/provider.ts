// A courier's own system (P07 task 9, D13). Nothing is connected in v2: a parcel is entered by hand and its status is moved by hand. The interface is
// here so that Steadfast and the others can be added later without touching the shipment code: a provider turns a shipment into a booking and
// reports where the parcel is. Until then every courier uses the manual provider, which books nothing and tracks nothing.

export type ParcelRequest = {
  shipmentNumber: string;
  recipientName: string;
  recipientPhone: string | null;
  address: string | null;
  codAmount: string;
};

export type ParcelBooking = { trackingCode: string | null };

export type ParcelStatus = "PICKED" | "IN_TRANSIT" | "DELIVERED" | "RETURNED" | "LOST";

export interface CourierProvider {
  /** The courier's `apiProvider` value that selects this provider; `manual` is the default. */
  readonly code: string;
  /** Books the parcel with the courier. The manual provider books nothing: the tracking code is typed in. */
  book(request: ParcelRequest): Promise<ParcelBooking>;
  /** Asks where the parcel is. The manual provider does not know: it answers nothing. */
  status(trackingCode: string): Promise<ParcelStatus | null>;
}

export const manualProvider: CourierProvider = {
  code: "manual",
  async book() {
    return { trackingCode: null };
  },
  async status() {
    return null;
  },
};

const providers = new Map<string, CourierProvider>([[manualProvider.code, manualProvider]]);

/** The provider for a courier's `apiProvider`; any courier without a connected one is manual. */
export function providerFor(code: string | null | undefined): CourierProvider {
  return (code ? providers.get(code) : undefined) ?? manualProvider;
}
