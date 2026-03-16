import { supabase } from "@/integrations/supabase/client";

/**
 * Creates an anonymous customer user record and returns the user_id.
 * Used by customer intake flows so jobs can be attributed to "Customer" source.
 */
export async function createCustomerUser(opts: {
  name?: string;
  phone?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: number;
}): Promise<string> {
  const { data, error } = await supabase
    .from("users")
    .insert({
      name: opts.name || "Customer",
      phone: opts.phone || null,
      vehicle_make: opts.vehicleMake || null,
      vehicle_model: opts.vehicleModel || null,
      vehicle_year: opts.vehicleYear || null,
    })
    .select("user_id")
    .single();
  if (error) throw error;
  return data.user_id;
}
