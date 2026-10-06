import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

console.log("Supabase URL:", supabaseUrl);
console.log("Supabase Key exists:", !!supabaseAnonKey);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: "pkce",
    detectSessionInUrl: true,
  },
});

export function setSessionPersistence(remember: boolean) {
  if (remember) {
    localStorage.removeItem("sb-no-remember");
  } else {
    localStorage.setItem("sb-no-remember", "1");
  }
}

export function shouldRememberSession(): boolean {
  return localStorage.getItem("sb-no-remember") !== "1";
}
