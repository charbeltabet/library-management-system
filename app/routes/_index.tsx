import { redirect } from "react-router";

export function loader() {
  return redirect("/books");
}

export default function Index() {
  return null;
}
