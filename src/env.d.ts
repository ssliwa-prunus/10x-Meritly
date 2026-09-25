declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
    /** The signed-in user's profile row, or null (signed out, no row, or lookup failed). */
    profile: import("@/types").Profile | null;
    /** True only when the profile query itself failed, so "no role" and "lookup failed" stay distinct. */
    profileError: boolean;
  }
}
