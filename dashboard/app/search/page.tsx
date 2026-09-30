import { redirect } from "next/navigation";

// Search now lives in the Notes page; keep the old URL working.
export default function SearchPage() {
  redirect("/memories");
}
