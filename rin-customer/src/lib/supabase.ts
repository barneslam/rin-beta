import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://zyoszbmahxnfcokuzkuv.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5b3N6Ym1haHhuZmNva3V6a3V2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMwMDY4MTUsImV4cCI6MjA1ODU4MjgxNX0.HMHPfOFn-AXFuFM7yJjSNLaQkP09BYdNmxG08tOrC6g";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export { SUPABASE_URL };
