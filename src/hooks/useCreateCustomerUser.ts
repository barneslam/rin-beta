import { supabaseExternal as supabase } from "@/lib/supabaseExternal";

/**
 * Find an existing user by phone number, or create a new one.
 * Returns the user_id. Phone is the primary identifier.
 */
export async function findOrCreateUserByPhone(opts: {
  phone: string;
  name?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: number;
}): Promise<string> {
  // 1. Try to find existing user by phone
  const { data: existing } = await supabase
    .from("users")
    .select("user_id")
    .eq("phone", opts.phone)
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Optionally update vehicle info if provided and user exists
    const updates: Record<string, unknown> = {};
    if (opts.vehicleMake) updates.vehicle_make = opts.vehicleMake;
    if (opts.vehicleModel) updates.vehicle_model = opts.vehicleModel;
    if (opts.vehicleYear) updates.vehicle_year = opts.vehicleYear;
    if (opts.name && opts.name !== "Customer") updates.name = opts.name;

    if (Object.keys(updates).length > 0) {
      await supabase.from("users").update(updates).eq("user_id", existing.user_id);
    }
    return existing.user_id;
  }

  // 2. Create new user
  const { data, error } = await supabase
    .from("users")
    .insert({
      name: opts.name || "Customer",
      phone: opts.phone,
      vehicle_make: opts.vehicleMake || null,
      vehicle_model: opts.vehicleModel || null,
      vehicle_year: opts.vehicleYear || null,
    })
    .select("user_id")
    .single();
  if (error) throw error;
  return data.user_id;
}

/**
 * @deprecated Use findOrCreateUserByPhone instead
 */
export async function createCustomerUser(opts: {
  name?: string;
  phone?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: number;
}): Promise<string> {
  if (opts.phone) {
    return findOrCreateUserByPhone({
      phone: opts.phone,
      name: opts.name,
      vehicleMake: opts.vehicleMake,
      vehicleModel: opts.vehicleModel,
      vehicleYear: opts.vehicleYear,
    });
  }
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
