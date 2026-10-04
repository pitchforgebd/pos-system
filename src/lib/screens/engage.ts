import { badge, date, text, type ScreenSpec } from "./types.ts";

const smsStats = [
  { label: "Sent today", value: "18" },
  { label: "Sent this month", value: "420" },
  { label: "Sent this year", value: "3,100" },
  { label: "Total sent", value: "3,100" },
];

export const engageScreens: ScreenSpec[] = [
  {
    path: "/sms",
    title: "SMS",
    description: "Sample SMS desk. Messages are not sent.",
    cta: "Send SMS",
    ctaHref: "/sms/send",
    kind: "list",
    stats: smsStats,
    columns: [date("date", "Date"), text("id", "To"), text("template", "Template"), badge("status", "Status")],
    rows: [
      { id: "01711000004", date: "2026-09-30", template: "Bill", status: "Pending" },
      { id: "01711000002", date: "2026-09-29", template: "Due collection", status: "Failed" },
    ],
  },
  {
    path: "/sms/dashboard",
    title: "SMS dashboard",
    description: "Sample SMS counters.",
    cta: "Send SMS",
    ctaHref: "/sms/send",
    kind: "list",
    stats: smsStats,
    columns: [text("id", "Metric"), text("value", "Value")],
    rows: smsStats.map((item) => ({ id: item.label, value: item.value })),
  },
  {
    path: "/sms/templates",
    title: "SMS templates",
    description: "Sample templates. Variables are text only and are not executed.",
    cta: "Save template",
    kind: "list",
    fields: [{ key: "body", label: "Message", kind: "textarea", required: true }],
    tabs: [
      {
        label: "Bill SMS",
        columns: [text("id", "Name"), text("body", "Message"), badge("status", "Status")],
        rows: [
          {
            id: "Bill",
            body: "Hello {customer_name}, invoice {invoice_number} total {total_bill}.",
            status: "Draft",
          },
        ],
      },
      {
        label: "Due collection",
        columns: [text("id", "Name"), text("body", "Message"), badge("status", "Status")],
        rows: [
          {
            id: "Due",
            body: "Hello {customer_name}, due {due_amount} after payment {paid_amount}.",
            status: "Draft",
          },
        ],
      },
    ],
  },
  {
    path: "/sms/send",
    title: "Send SMS",
    description: "Compose layout only. No provider is called.",
    cta: "Check message",
    kind: "form",
    fields: [
      { key: "phone", label: "Phone", required: true },
      { key: "message", label: "Message", kind: "textarea", required: true },
    ],
  },
  {
    path: "/sms/history",
    title: "SMS history",
    description: "Sample send history.",
    cta: "Send SMS",
    ctaHref: "/sms/send",
    kind: "list",
    columns: [date("date", "Date"), text("id", "To"), text("message", "Message"), badge("status", "Status")],
    rows: [
      { id: "01711000004", date: "2026-09-30", message: "Sample bill message", status: "Pending" },
      { id: "01711000002", date: "2026-09-29", message: "Sample due message", status: "Failed" },
      { id: "01711000001", date: "2026-09-28", message: "Sample bill message", status: "Sent" },
    ],
  },
  {
    path: "/sms/settings",
    title: "SMS settings",
    description: "Provider credentials stay in environment variables. This form does not store them.",
    cta: "Check settings",
    kind: "form",
    fields: [
      { key: "sender", label: "Sender name", required: true },
      { key: "provider", label: "Provider label" },
    ],
  },
  {
    path: "/crm",
    title: "CRM",
    description: "Sample contacts and follow-ups. Nothing is assigned for real.",
    cta: "Add contact",
    kind: "list",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "phone", label: "Phone", required: true },
    ],
    tabs: [
      {
        label: "Contacts",
        columns: [text("id", "Code"), text("name", "Contact"), text("phone", "Phone"), text("segment", "Segment"), badge("status", "Status")],
        rows: [
          { id: "CRM-0003", name: "City Grocers", phone: "01711000004", segment: "Wholesale", status: "Active" },
          { id: "CRM-0002", name: "North Wharf Store", phone: "01711000003", segment: "Dealer", status: "Active" },
          { id: "CRM-0001", name: "Walk-in lead", phone: "01711000999", segment: "New", status: "Pending" },
        ],
      },
      {
        label: "Follow-ups",
        columns: [text("id", "Activity"), date("date", "Date"), text("contact", "Contact"), text("note", "Note"), badge("status", "Status")],
        rows: [
          { id: "ACT-0002", date: "2026-10-02", contact: "City Grocers", note: "Call about due", status: "Pending" },
          { id: "ACT-0001", date: "2026-09-25", contact: "North Wharf Store", note: "Visit shop", status: "Closed" },
        ],
      },
    ],
  },
];
