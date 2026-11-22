import { redirect } from "next/navigation";

/** The home is Plan; the query (e.g. ?replay=…) goes along. */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) for (const x of [v ?? []].flat()) sp.append(k, x);
  const qs = sp.toString();
  redirect(qs ? `/plan?${qs}` : "/plan");
}
