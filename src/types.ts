/** Access role; mirrors the `public.app_role` enum. */
export type AppRole = "admin" | "supervisor" | "employee";

/** Row of `public.profiles` as exposed to the app (created_at omitted). */
export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  role: AppRole;
}
