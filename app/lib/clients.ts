import type { SupabaseClient } from "@supabase/supabase-js";

/** Sage `clients.ct_type` — revendeurs shown in client dropdowns and palmarès. */
export const CLIENT_CT_TYPE_RESELLER = 0;

export function resellerClientsQuery(supabase: SupabaseClient) {
  return supabase
    .from("clients")
    .select("ct_num, name, ct_type")
    .eq("ct_type", CLIENT_CT_TYPE_RESELLER);
}
