import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://zyoszbmahxnfcokuzkuv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5b3N6Ym1haHhuZmNva3V6a3V2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDU3OTMsImV4cCI6MjA4OTA4MTc5M30.Ilz4RYTcgZU3IMnABg0eV7iAfFcC0iykyl4DOln-mjY";

export const supabaseExternal = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
