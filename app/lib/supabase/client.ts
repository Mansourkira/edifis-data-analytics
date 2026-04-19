import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const globalForSupabase = globalThis as unknown as {
  __edifisBrowserSupabase?: SupabaseClient;
};

/**
 * Supabase client with ANON key for frontend.
 * Safe to use in browser. Never use service role here.
 * Singleton avoids multiple GoTrueClient instances in the same browser context.
 */
export function createBrowserSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase client config: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set"
    );
  }

  if (!globalForSupabase.__edifisBrowserSupabase) {
    globalForSupabase.__edifisBrowserSupabase = createClient(url, anonKey);
  }

  return globalForSupabase.__edifisBrowserSupabase;
}
