"use client";

import { useState } from "react";
import { z } from "zod";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DatePicker } from "@/components/ui/date-picker";
import { describedBy, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { FormFieldSpec } from "@/lib/screens/types";

function fieldSchema(field: FormFieldSpec) {
  if (field.kind === "money") {
    return z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter a price with up to two decimals.");
  }
  if (field.required) {
    return z.string().trim().min(1, `Enter ${field.label.toLowerCase()}.`);
  }
  return z.string();
}

export function EntryForm({
  fields,
  submitLabel,
  formId = "screen-form",
  onCancel,
}: {
  fields: FormFieldSpec[];
  submitLabel: string;
  formId?: string;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((field) => [field.key, ""])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);

  return (
    <form
      id={formId}
      className="space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const schema = z.object(Object.fromEntries(fields.map((field) => [field.key, fieldSchema(field)])));
        const parsed = schema.safeParse(values);
        if (!parsed.success) {
          const next: Record<string, string> = {};
          for (const issue of parsed.error.issues) {
            const key = String(issue.path[0] ?? "");
            if (key && !next[key]) {
              next[key] = issue.message;
            }
          }
          setErrors(next);
          setChecked(false);
          return;
        }
        setErrors({});
        setChecked(true);
      }}
    >
      {checked ? (
        <Alert tone="success" title="Fields checked">
          Nothing was saved. Storage starts in a later phase.
        </Alert>
      ) : null}
      {fields.map((field) => {
        const id = `field-${field.key}`;
        const error = errors[field.key];
        return (
          <FormField key={field.key} label={field.label} htmlFor={id} required={field.required} error={error}>
            {field.kind === "textarea" ? (
              <Textarea
                id={id}
                value={values[field.key] ?? ""}
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={describedBy(id, undefined, error)}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
              />
            ) : field.kind === "select" ? (
              <Select
                id={id}
                value={values[field.key] ?? ""}
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={describedBy(id, undefined, error)}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
              >
                <option value="">Choose</option>
                {field.options?.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            ) : field.kind === "money" ? (
              <CurrencyInput
                id={id}
                value={values[field.key] ?? ""}
                invalid={Boolean(error)}
                describedById={describedBy(id, undefined, error)}
                onChange={(next) => setValues((current) => ({ ...current, [field.key]: next }))}
              />
            ) : field.kind === "date" ? (
              <DatePicker
                id={id}
                value={values[field.key] ? values[field.key] : null}
                onChange={(next) => setValues((current) => ({ ...current, [field.key]: next ?? "" }))}
              />
            ) : (
              <Input
                id={id}
                value={values[field.key] ?? ""}
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={describedBy(id, undefined, error)}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
              />
            )}
          </FormField>
        );
      })}
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit">{submitLabel}</Button>
      </div>
    </form>
  );
}
