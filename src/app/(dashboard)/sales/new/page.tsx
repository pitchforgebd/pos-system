import { redirect } from "next/navigation";

// A new sale is made at the register.
export default function NewSalePage() {
  redirect("/pos");
}
