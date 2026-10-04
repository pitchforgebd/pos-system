"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DatePicker } from "@/components/ui/date-picker";
import { Drawer } from "@/components/ui/drawer";
import { describedBy, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { QuantityInput } from "@/components/ui/quantity-input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { sampleCategories, sampleUnits } from "@/lib/mock/dashboard";

const productPreviewSchema = z.object({
  name: z.string().trim().min(2, "Enter a product name."),
  sku: z.string().trim().min(1, "Enter a SKU."),
  category: z.string().min(1, "Choose a category."),
  unit: z.string().min(1, "Choose a unit."),
  purchasePrice: z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter a price with up to two decimals."),
  sellingPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter a price with up to two decimals."),
  quantity: z.number().int().min(0, "Quantity cannot be negative."),
  warrantyEnds: z.string().nullable(),
  description: z.string().max(500, "Keep the description under 500 characters."),
});

type ProductPreviewInput = z.infer<typeof productPreviewSchema>;

const emptyValues: ProductPreviewInput = {
  name: "",
  sku: "",
  category: "",
  unit: "pcs",
  purchasePrice: "",
  sellingPrice: "",
  quantity: 0,
  warrantyEnds: null,
  description: "",
};

export function ProductPreviewDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [discardOpen, setDiscardOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const form = useForm<ProductPreviewInput>({
    resolver: zodResolver(productPreviewSchema),
    defaultValues: emptyValues,
  });
  const quantity = useWatch({ control: form.control, name: "quantity" });
  const category = useWatch({ control: form.control, name: "category" });
  const warrantyEnds = useWatch({ control: form.control, name: "warrantyEnds" });
  const purchasePrice = useWatch({ control: form.control, name: "purchasePrice" });
  const sellingPrice = useWatch({ control: form.control, name: "sellingPrice" });

  function close() {
    form.reset(emptyValues);
    setChecked(false);
    onOpenChange(false);
  }

  function requestClose() {
    if (form.formState.isDirty) {
      setDiscardOpen(true);
      return;
    }
    close();
  }

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={(next) => {
          if (next) {
            onOpenChange(true);
            return;
          }
          requestClose();
        }}
        title="Add product"
        description="Preview the product form. Submitting checks the fields and does not save a product."
      >
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit(() => {
            setChecked(true);
            form.reset(emptyValues);
          })}
          noValidate
        >
          {checked ? (
            <Alert tone="success" title="Fields checked">
              This product was not saved. Storage starts in a later phase.
            </Alert>
          ) : null}
          <FormField label="Product name" htmlFor="product-name" required error={form.formState.errors.name?.message}>
            <Input
              id="product-name"
              aria-invalid={Boolean(form.formState.errors.name) || undefined}
              aria-describedby={describedBy("product-name", undefined, form.formState.errors.name?.message)}
              {...form.register("name")}
            />
          </FormField>
          <FormField label="SKU" htmlFor="product-sku" required error={form.formState.errors.sku?.message}>
            <Input
              id="product-sku"
              aria-invalid={Boolean(form.formState.errors.sku) || undefined}
              aria-describedby={describedBy("product-sku", undefined, form.formState.errors.sku?.message)}
              {...form.register("sku")}
            />
          </FormField>
          <FormField label="Category" htmlFor="product-category" required error={form.formState.errors.category?.message}>
            <Combobox
              id="product-category"
              options={sampleCategories}
              value={category}
              invalid={Boolean(form.formState.errors.category)}
              describedById={describedBy("product-category", undefined, form.formState.errors.category?.message)}
              onChange={(next) => form.setValue("category", next, { shouldDirty: true, shouldValidate: true })}
            />
          </FormField>
          <FormField label="Unit" htmlFor="product-unit" required error={form.formState.errors.unit?.message}>
            <Select
              id="product-unit"
              aria-invalid={Boolean(form.formState.errors.unit) || undefined}
              aria-describedby={describedBy("product-unit", undefined, form.formState.errors.unit?.message)}
              {...form.register("unit")}
            >
              {sampleUnits.map((unit) => (
                <option key={unit.value} value={unit.value}>
                  {unit.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label="Purchase price"
            htmlFor="product-purchase"
            required
            error={form.formState.errors.purchasePrice?.message}
          >
            <CurrencyInput
              id="product-purchase"
              value={purchasePrice}
              invalid={Boolean(form.formState.errors.purchasePrice)}
              describedById={describedBy("product-purchase", undefined, form.formState.errors.purchasePrice?.message)}
              onChange={(next) => form.setValue("purchasePrice", next, { shouldDirty: true, shouldValidate: true })}
            />
          </FormField>
          <FormField
            label="Selling price"
            htmlFor="product-selling"
            required
            error={form.formState.errors.sellingPrice?.message}
          >
            <CurrencyInput
              id="product-selling"
              value={sellingPrice}
              invalid={Boolean(form.formState.errors.sellingPrice)}
              describedById={describedBy("product-selling", undefined, form.formState.errors.sellingPrice?.message)}
              onChange={(next) => form.setValue("sellingPrice", next, { shouldDirty: true, shouldValidate: true })}
            />
          </FormField>
          <FormField label="Quantity" htmlFor="product-qty" hint="Display control only." error={form.formState.errors.quantity?.message}>
            <QuantityInput
              id="product-qty"
              value={quantity}
              invalid={Boolean(form.formState.errors.quantity)}
              describedById={describedBy("product-qty", "Display control only.", form.formState.errors.quantity?.message)}
              onChange={(next) => form.setValue("quantity", next, { shouldDirty: true, shouldValidate: true })}
            />
          </FormField>
          <FormField label="Warranty end" htmlFor="product-warranty">
            <DatePicker
              id="product-warranty"
              value={warrantyEnds}
              onChange={(next) => form.setValue("warrantyEnds", next, { shouldDirty: true })}
            />
          </FormField>
          <FormField label="Description" htmlFor="product-description" error={form.formState.errors.description?.message}>
            <Textarea
              id="product-description"
              aria-invalid={Boolean(form.formState.errors.description) || undefined}
              aria-describedby={describedBy("product-description", undefined, form.formState.errors.description?.message)}
              {...form.register("description")}
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit">Check fields</Button>
          </div>
        </form>
      </Drawer>
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard this draft?"
        description="The form is cleared in the browser. Nothing was stored."
        confirmLabel="Discard"
        tone="danger"
        onConfirm={close}
      />
    </>
  );
}
