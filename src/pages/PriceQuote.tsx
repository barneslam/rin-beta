import { useState, useEffect, useCallback } from "react";
import { supabaseExternal as supabase } from "@/lib/supabaseExternal";

const MOBILE_STYLES = `
  .pq-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .pq-container { max-width: 900px; margin: 0 auto; padding: 24px 20px; }
  .pq-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
  .pq-ref-table { overflow-x: auto; }
  .pq-ref-table table { min-width: 400px; }
  @media (max-width: 768px) {
    .pq-grid { grid-template-columns: 1fr; }
    .pq-container { padding: 12px; }
    .pq-header h1 { font-size: 22px !important; }
    .pq-header { flex-direction: column; align-items: flex-start; }
  }
`;

interface PricingConfig {
  incident_type_id: string;
  incident_name: string;
  base_rate: number;
  per_km_rate: number;
  min_fee: number;
  cancellation_fee_pct: number;
}

interface DistanceTier {
  tier_name: string;
  min_km: number;
  max_km: number | null;
  per_km_rate: number;
}

interface Multiplier {
  name: string;
  multiplier: number;
  start_hour: number;
  end_hour: number;
  days_of_week: number[];
}

interface LongDistanceOverride {
  incident_type_id: string;
  min_distance_km: number;
  base_rate_override: number;
  description: string;
}

interface TierBreakdown {
  tier: string;
  km: number;
  rate: number;
  charge: number;
}

interface QuoteResult {
  base_rate: number;
  base_rate_overridden: boolean;
  original_base: number;
  distance_km: number;
  distance_charge: number;
  tier_breakdown: TierBreakdown[];
  time_multiplier: number;
  time_period: string;
  luxury_surcharge: number;
  subtotal: number;
  min_fee: number;
  final_price: number;
  cancellation_fee: number;
}

const LUXURY_MAKES = [
  "BMW", "Mercedes-Benz", "Audi", "Porsche", "Lexus", "Tesla",
  "Jaguar", "Land Rover", "Range Rover", "Maserati", "Bentley", "Rolls-Royce",
  "Ferrari", "Lamborghini", "McLaren", "Aston Martin",
  "Genesis", "Infiniti", "Acura", "Lotus", "Bugatti", "Cadillac", "Lincoln"
];

// NHTSA-sourced vehicle makes for North American market
const VEHICLE_MAKES: { name: string; luxury: boolean }[] = [
  // Luxury / Premium
  { name: "Acura", luxury: true },
  { name: "Alfa Romeo", luxury: false },
  { name: "Aston Martin", luxury: true },
  { name: "Audi", luxury: true },
  { name: "Bentley", luxury: true },
  { name: "BMW", luxury: true },
  { name: "Bugatti", luxury: true },
  { name: "Buick", luxury: false },
  { name: "Cadillac", luxury: true },
  { name: "Chevrolet", luxury: false },
  { name: "Chrysler", luxury: false },
  { name: "Dodge", luxury: false },
  { name: "Ferrari", luxury: true },
  { name: "Fiat", luxury: false },
  { name: "Ford", luxury: false },
  { name: "Genesis", luxury: true },
  { name: "GMC", luxury: false },
  { name: "Honda", luxury: false },
  { name: "Hyundai", luxury: false },
  { name: "Infiniti", luxury: true },
  { name: "Jaguar", luxury: true },
  { name: "Jeep", luxury: false },
  { name: "Kia", luxury: false },
  { name: "Lamborghini", luxury: true },
  { name: "Land Rover", luxury: true },
  { name: "Lexus", luxury: true },
  { name: "Lincoln", luxury: true },
  { name: "Lotus", luxury: true },
  { name: "Maserati", luxury: true },
  { name: "Mazda", luxury: false },
  { name: "McLaren", luxury: true },
  { name: "Mercedes-Benz", luxury: true },
  { name: "Mini", luxury: false },
  { name: "Mitsubishi", luxury: false },
  { name: "Nissan", luxury: false },
  { name: "Polestar", luxury: true },
  { name: "Porsche", luxury: true },
  { name: "Ram", luxury: false },
  { name: "Rivian", luxury: true },
  { name: "Rolls-Royce", luxury: true },
  { name: "Subaru", luxury: false },
  { name: "Suzuki", luxury: false },
  { name: "Tesla", luxury: true },
  { name: "Toyota", luxury: false },
  { name: "Volkswagen", luxury: false },
  { name: "Volvo", luxury: false },
];

interface AuthUser {
  user_id: string;
  username: string;
  full_name: string;
  company: string;
}

export default function PriceQuote() {
  // Auth state
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [authView, setAuthView] = useState<"login" | "register" | "forgot">("login");

  // Registration state
  const [regUsername, setRegUsername] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");
  const [regFullName, setRegFullName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regCompany, setRegCompany] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regError, setRegError] = useState("");
  const [regSuccess, setRegSuccess] = useState("");
  const [regLoading, setRegLoading] = useState(false);

  // Forgot password state
  const [forgotUsername, setForgotUsername] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotNewPassword, setForgotNewPassword] = useState("");
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState("");
  const [forgotError, setForgotError] = useState("");
  const [forgotSuccess, setForgotSuccess] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);

  const [pricingConfigs, setPricingConfigs] = useState<PricingConfig[]>([]);
  const [distanceTiers, setDistanceTiers] = useState<DistanceTier[]>([]);
  const [multipliers, setMultipliers] = useState<Multiplier[]>([]);
  const [overrides, setOverrides] = useState<LongDistanceOverride[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [selectedIncident, setSelectedIncident] = useState("");
  const [distance, setDistance] = useState(10);
  const [vehicleMake, setVehicleMake] = useState("");
  const [timeOfDay, setTimeOfDay] = useState("standard");

  const [showReference, setShowReference] = useState(false);

  // Result
  const [quote, setQuote] = useState<QuoteResult | null>(null);

  useEffect(() => {
    loadPricingData();
  }, []);

  async function loadPricingData() {
    const [configRes, tiersRes, multRes, overrideRes] = await Promise.all([
      supabase.from("pricing_config").select("*, incident_types(incident_name)").eq("is_active", true),
      supabase.from("distance_tiers").select("*").eq("is_active", true).order("min_km"),
      supabase.from("pricing_multipliers").select("*").eq("is_active", true),
      supabase.from("long_distance_overrides").select("*").eq("is_active", true),
    ]);

    const configs: PricingConfig[] = (configRes.data || []).map((c: any) => ({
      incident_type_id: c.incident_type_id,
      incident_name: c.incident_types?.incident_name || "Unknown",
      base_rate: parseFloat(c.base_rate),
      per_km_rate: parseFloat(c.per_km_rate),
      min_fee: parseFloat(c.min_fee),
      cancellation_fee_pct: parseFloat(c.cancellation_fee_pct),
    }));
    configs.sort((a, b) => a.incident_name.localeCompare(b.incident_name));

    setPricingConfigs(configs);
    setDistanceTiers((tiersRes.data || []).map((t: any) => ({
      tier_name: t.tier_name,
      min_km: parseFloat(t.min_km),
      max_km: t.max_km ? parseFloat(t.max_km) : null,
      per_km_rate: parseFloat(t.per_km_rate),
    })));
    setMultipliers((multRes.data || []).map((m: any) => ({
      name: m.name,
      multiplier: parseFloat(m.multiplier),
      start_hour: m.start_hour,
      end_hour: m.end_hour,
      days_of_week: m.days_of_week,
    })));
    setOverrides((overrideRes.data || []).map((o: any) => ({
      incident_type_id: o.incident_type_id,
      min_distance_km: parseFloat(o.min_distance_km),
      base_rate_override: parseFloat(o.base_rate_override),
      description: o.description,
    })));

    if (configs.length > 0) setSelectedIncident(configs[0].incident_type_id);
    setLoading(false);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);

    const { data, error } = await supabase.rpc("verify_quote_login", {
      p_username: loginUsername.toLowerCase().trim(),
      p_password: loginPassword,
    });

    if (error || !data || !(data as any).success) {
      setLoginError((data as any)?.error || "Login failed");
      setLoginLoading(false);
      return;
    }

    const user: AuthUser = {
      user_id: (data as any).user_id,
      username: (data as any).username,
      full_name: (data as any).full_name,
      company: (data as any).company || "",
    };

    // Log login
    await supabase.from("quote_usage_log").insert({
      user_id: user.user_id,
      username: user.username,
      action: "login",
      details: { full_name: user.full_name, company: user.company },
    });

    setAuthUser(user);
    setLoginLoading(false);
    setShowDisclaimer(true);
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setRegError("");
    setRegSuccess("");

    if (regPassword !== regConfirmPassword) {
      setRegError("Passwords do not match");
      return;
    }
    if (regPassword.length < 6) {
      setRegError("Password must be at least 6 characters");
      return;
    }
    if (!regUsername || !regFullName || !regPhone) {
      setRegError("Full name, username, and phone number are required");
      return;
    }

    setRegLoading(true);
    const { data, error } = await supabase.rpc("register_quote_user", {
      p_username: regUsername.toLowerCase().trim(),
      p_password: regPassword,
      p_full_name: regFullName.trim(),
      p_email: regEmail.toLowerCase().trim(),
      p_company: regCompany.trim(),
      p_phone: regPhone.trim(),
    });

    if (error || !data || !(data as any).success) {
      setRegError((data as any)?.error || error?.message || "Registration failed");
      setRegLoading(false);
      return;
    }

    setRegSuccess("Account created! You can now sign in.");
    setRegLoading(false);
    setTimeout(() => {
      setAuthView("login");
      setLoginUsername(regUsername.toLowerCase().trim());
      setRegSuccess("");
    }, 2000);
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setForgotError("");
    setForgotSuccess("");

    if (forgotNewPassword !== forgotConfirmPassword) {
      setForgotError("Passwords do not match");
      return;
    }
    if (forgotNewPassword.length < 6) {
      setForgotError("Password must be at least 6 characters");
      return;
    }

    setForgotLoading(true);
    const { data, error } = await supabase.rpc("reset_quote_password", {
      p_username: forgotUsername.toLowerCase().trim(),
      p_email: forgotEmail.toLowerCase().trim(),
      p_new_password: forgotNewPassword,
    });

    if (error || !data || !(data as any).success) {
      setForgotError((data as any)?.error || error?.message || "Reset failed");
      setForgotLoading(false);
      return;
    }

    setForgotSuccess("Password reset! You can now sign in.");
    setForgotLoading(false);
    setTimeout(() => {
      setAuthView("login");
      setLoginUsername(forgotUsername.toLowerCase().trim());
      setForgotSuccess("");
    }, 2000);
  }

  async function handleDisclaimerAccept() {
    if (!authUser) return;

    // Log agreement
    await supabase.from("quote_disclaimer_agreements").insert({
      user_id: authUser.user_id,
      username: authUser.username,
      full_name: authUser.full_name,
      disclaimer_version: "1.0",
      user_agent: navigator.userAgent,
    });

    // Log usage
    await supabase.from("quote_usage_log").insert({
      user_id: authUser.user_id,
      username: authUser.username,
      action: "disclaimer_accepted",
      details: { version: "1.0" },
    });

    setDisclaimerAccepted(true);
    setShowDisclaimer(false);
  }

  function handleLogout() {
    if (authUser) {
      supabase.from("quote_usage_log").insert({
        user_id: authUser.user_id,
        username: authUser.username,
        action: "logout",
      });
    }
    setAuthUser(null);
    setDisclaimerAccepted(false);
  }

  const calculateQuote = useCallback(() => {
    const config = pricingConfigs.find(c => c.incident_type_id === selectedIncident);
    if (!config) return;

    let baseRate = config.base_rate;
    let baseOverridden = false;
    const originalBase = config.base_rate;

    // Check long-distance override
    const override = overrides.find(
      o => o.incident_type_id === selectedIncident && distance >= o.min_distance_km
    );
    if (override) {
      baseRate = override.base_rate_override;
      baseOverridden = true;
    }

    // Calculate tiered distance
    let distanceCharge = 0;
    const tierBreakdown: TierBreakdown[] = [];
    let remainingKm = distance;

    for (const tier of distanceTiers) {
      if (remainingKm <= 0) break;
      if (distance <= tier.min_km) continue;

      let tierKm: number;
      if (tier.max_km !== null) {
        tierKm = Math.min(remainingKm, Math.max(Math.min(distance, tier.max_km) - tier.min_km, 0));
      } else {
        tierKm = Math.max(distance - tier.min_km, 0);
      }
      tierKm = Math.min(tierKm, remainingKm);

      if (tierKm > 0) {
        const charge = tierKm * tier.per_km_rate;
        distanceCharge += charge;
        remainingKm -= tierKm;
        tierBreakdown.push({
          tier: tier.tier_name,
          km: Math.round(tierKm * 100) / 100,
          rate: tier.per_km_rate,
          charge: Math.round(charge * 100) / 100,
        });
      }
    }

    // Fallback if no tiers matched
    if (distanceCharge === 0 && distance > 0) {
      distanceCharge = distance * config.per_km_rate;
      tierBreakdown.push({
        tier: "Flat Rate (fallback)",
        km: distance,
        rate: config.per_km_rate,
        charge: Math.round(distanceCharge * 100) / 100,
      });
    }

    // Time multiplier
    let timeMultiplier = 1.0;
    let timePeriod = "standard";
    if (timeOfDay !== "standard") {
      const mult = multipliers.find(m => m.name === timeOfDay);
      if (mult) {
        timeMultiplier = mult.multiplier;
        timePeriod = mult.name;
      }
    }

    // Luxury surcharge
    let luxurySurcharge = 0;
    if (vehicleMake && LUXURY_MAKES.some(m => m.toLowerCase() === vehicleMake.toLowerCase())) {
      luxurySurcharge = baseRate * 0.25;
    }

    // Final calculation
    const subtotal = (baseRate + distanceCharge + luxurySurcharge) * timeMultiplier;
    const finalPrice = Math.max(subtotal, config.min_fee);
    const cancellationFee = finalPrice * config.cancellation_fee_pct / 100;

    setQuote({
      base_rate: baseRate,
      base_rate_overridden: baseOverridden,
      original_base: originalBase,
      distance_km: distance,
      distance_charge: Math.round(distanceCharge * 100) / 100,
      tier_breakdown: tierBreakdown,
      time_multiplier: timeMultiplier,
      time_period: timePeriod,
      luxury_surcharge: Math.round(luxurySurcharge * 100) / 100,
      subtotal: Math.round(subtotal * 100) / 100,
      min_fee: config.min_fee,
      final_price: Math.round(finalPrice * 100) / 100,
      cancellation_fee: Math.round(cancellationFee * 100) / 100,
    });
  }, [selectedIncident, distance, vehicleMake, timeOfDay, pricingConfigs, distanceTiers, multipliers, overrides]);

  useEffect(() => {
    if (!loading && selectedIncident) calculateQuote();
  }, [loading, selectedIncident, distance, vehicleMake, timeOfDay, calculateQuote]);

  // ===== AUTH SCREENS (Login / Register / Forgot) =====
  if (!authUser) {
    const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ced4da", fontSize: 15, marginBottom: 14, boxSizing: "border-box" as const };
    const labelStyle = { display: "block" as const, fontWeight: 600, fontSize: 13, color: "#495057", marginBottom: 4 };
    const btnStyle = { width: "100%", padding: "12px", borderRadius: 8, background: "#0d6efd", color: "white", fontSize: 16, fontWeight: 600, border: "none", cursor: "pointer" };
    const linkStyle = { color: "#0d6efd", cursor: "pointer", textDecoration: "underline", background: "none", border: "none", fontSize: 13, padding: 0 };

    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", padding: 16, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", background: "#f8f9fa", boxSizing: "border-box" }}>
        <div style={{ width: "100%", maxWidth: 420, background: "#fff", borderRadius: 16, padding: "32px 24px", border: "1px solid #dee2e6", boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: "#0d6efd", marginBottom: 4 }}>RIN</div>
            <div style={{ fontSize: 14, color: "#6c757d" }}>
              {authView === "login" && "Price Quote Tool — Sign In"}
              {authView === "register" && "Create Your Account"}
              {authView === "forgot" && "Reset Your Password"}
            </div>
          </div>

          {/* === LOGIN === */}
          {authView === "login" && (
            <form onSubmit={handleLogin}>
              <label style={labelStyle}>Username</label>
              <input type="text" value={loginUsername} onChange={e => setLoginUsername(e.target.value)} placeholder="Enter your username" autoFocus style={inputStyle} />
              <label style={labelStyle}>Password</label>
              <input type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder="Enter your password" style={inputStyle} />
              {loginError && <p style={{ color: "#dc3545", fontSize: 13, margin: "0 0 12px" }}>{loginError}</p>}
              <button type="submit" disabled={loginLoading || !loginUsername || !loginPassword} style={{ ...btnStyle, opacity: loginLoading ? 0.6 : 1, marginBottom: 16 }}>
                {loginLoading ? "Signing in..." : "Sign In"}
              </button>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <button type="button" onClick={() => { setAuthView("register"); setLoginError(""); }} style={linkStyle}>Create Account</button>
                <button type="button" onClick={() => { setAuthView("forgot"); setLoginError(""); }} style={linkStyle}>Forgot Password?</button>
              </div>
            </form>
          )}

          {/* === REGISTER === */}
          {authView === "register" && (
            <form onSubmit={handleRegister}>
              <label style={labelStyle}>Full Name *</label>
              <input type="text" value={regFullName} onChange={e => setRegFullName(e.target.value)} placeholder="e.g. Abdul Hakim Hussein" autoFocus style={inputStyle} />
              <label style={labelStyle}>Phone Number *</label>
              <input type="tel" value={regPhone} onChange={e => setRegPhone(e.target.value)} placeholder="+1 (647) 555-1234" style={inputStyle} />
              <label style={labelStyle}>Username *</label>
              <input type="text" value={regUsername} onChange={e => setRegUsername(e.target.value)} placeholder="Choose a username" style={inputStyle} />
              <label style={labelStyle}>Email</label>
              <input type="email" value={regEmail} onChange={e => setRegEmail(e.target.value)} placeholder="your@email.com (for password recovery)" style={inputStyle} />
              <label style={labelStyle}>Company</label>
              <input type="text" value={regCompany} onChange={e => setRegCompany(e.target.value)} placeholder="e.g. FastTow Toronto" style={inputStyle} />
              <label style={labelStyle}>Password * <span style={{ fontWeight: 400, color: "#999" }}>(min 6 characters)</span></label>
              <input type="password" value={regPassword} onChange={e => setRegPassword(e.target.value)} placeholder="Create a password" style={inputStyle} />
              <label style={labelStyle}>Confirm Password *</label>
              <input type="password" value={regConfirmPassword} onChange={e => setRegConfirmPassword(e.target.value)} placeholder="Re-enter your password" style={inputStyle} />
              {regError && <p style={{ color: "#dc3545", fontSize: 13, margin: "0 0 12px" }}>{regError}</p>}
              {regSuccess && <p style={{ color: "#198754", fontSize: 13, margin: "0 0 12px", fontWeight: 600 }}>{regSuccess}</p>}
              <button type="submit" disabled={regLoading} style={{ ...btnStyle, background: "#198754", opacity: regLoading ? 0.6 : 1, marginBottom: 16 }}>
                {regLoading ? "Creating Account..." : "Create Account"}
              </button>
              <div style={{ textAlign: "center" }}>
                <button type="button" onClick={() => { setAuthView("login"); setRegError(""); setRegSuccess(""); }} style={linkStyle}>Already have an account? Sign In</button>
              </div>
            </form>
          )}

          {/* === FORGOT PASSWORD === */}
          {authView === "forgot" && (
            <form onSubmit={handleForgotPassword}>
              <p style={{ fontSize: 13, color: "#6c757d", marginTop: 0, marginBottom: 16 }}>
                Enter your username and the email address associated with your account to set a new password.
              </p>
              <label style={labelStyle}>Username</label>
              <input type="text" value={forgotUsername} onChange={e => setForgotUsername(e.target.value)} placeholder="Your username" autoFocus style={inputStyle} />
              <label style={labelStyle}>Email Address</label>
              <input type="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} placeholder="Email used during registration" style={inputStyle} />
              <label style={labelStyle}>New Password <span style={{ fontWeight: 400, color: "#999" }}>(min 6 characters)</span></label>
              <input type="password" value={forgotNewPassword} onChange={e => setForgotNewPassword(e.target.value)} placeholder="Choose a new password" style={inputStyle} />
              <label style={labelStyle}>Confirm New Password</label>
              <input type="password" value={forgotConfirmPassword} onChange={e => setForgotConfirmPassword(e.target.value)} placeholder="Re-enter new password" style={inputStyle} />
              {forgotError && <p style={{ color: "#dc3545", fontSize: 13, margin: "0 0 12px" }}>{forgotError}</p>}
              {forgotSuccess && <p style={{ color: "#198754", fontSize: 13, margin: "0 0 12px", fontWeight: 600 }}>{forgotSuccess}</p>}
              <button type="submit" disabled={forgotLoading} style={{ ...btnStyle, background: "#fd7e14", opacity: forgotLoading ? 0.6 : 1, marginBottom: 16 }}>
                {forgotLoading ? "Resetting..." : "Reset Password"}
              </button>
              <div style={{ textAlign: "center" }}>
                <button type="button" onClick={() => { setAuthView("login"); setForgotError(""); setForgotSuccess(""); }} style={linkStyle}>Back to Sign In</button>
              </div>
            </form>
          )}

          <p style={{ textAlign: "center", fontSize: 11, color: "#adb5bd", marginTop: 20, marginBottom: 0, lineHeight: 1.5 }}>
            This tool is restricted to authorized RIN personnel only.<br />
            All access is logged and audited.
          </p>
        </div>
      </div>
    );
  }

  // ===== DISCLAIMER POPUP =====
  if (showDisclaimer || !disclaimerAccepted) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", padding: 16, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", background: "rgba(0,0,0,0.5)", boxSizing: "border-box" }}>
        <div style={{ width: "100%", maxWidth: 600, maxHeight: "90vh", overflow: "auto", background: "#fff", borderRadius: 16, padding: "32px 24px", border: "1px solid #dee2e6", boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#dc3545" }}>Disclaimer &amp; Terms of Use</div>
            <p style={{ color: "#6c757d", fontSize: 13 }}>Please read carefully before proceeding</p>
          </div>

          <div style={{ background: "#f8f9fa", borderRadius: 8, padding: 20, fontSize: 13, lineHeight: 1.8, maxHeight: 340, overflow: "auto", border: "1px solid #dee2e6", marginBottom: 24 }}>
            <p style={{ fontWeight: 700, fontSize: 15, marginTop: 0 }}>RIN PRICE QUOTE TOOL &mdash; TERMS OF USE</p>
            <p style={{ fontWeight: 700 }}>Operated by Roadside Intelligence Network</p>
            <p>Registered at Suite 800, 1200 Brickell Avenue, FL 33131, Miami, USA</p>

            <p style={{ fontWeight: 700, marginTop: 16 }}>1. For Reference Only</p>
            <p>All pricing information, estimates, and quotes generated by this tool are provided <strong>for reference and verification purposes only</strong>. They do not constitute a binding offer, contract, or guarantee of pricing for any roadside assistance service.</p>

            <p style={{ fontWeight: 700, marginTop: 16 }}>2. No Warranty or Liability</p>
            <p>This tool is provided "as is" without warranty of any kind. Roadside Intelligence Network, its affiliates, and its partners <strong>make no representations or warranties</strong> regarding the accuracy, completeness, or reliability of any pricing data displayed. To the maximum extent permitted by law, we shall not be liable for any direct, indirect, incidental, or consequential damages arising from the use of this tool.</p>

            <p style={{ fontWeight: 700, marginTop: 16 }}>3. Indemnification</p>
            <p>By using this tool, you agree to <strong>indemnify, defend, and hold harmless</strong> Roadside Intelligence Network, its officers, directors, employees, agents, and partners from and against any and all claims, liabilities, damages, losses, or expenses (including reasonable legal fees) arising from or related to your use of this tool or any reliance on pricing information provided herein.</p>

            <p style={{ fontWeight: 700, marginTop: 16 }}>4. Data Collection &amp; Privacy</p>
            <p>Your login activity, tool usage, and agreement acceptance are logged for audit and security purposes. We collect your username, timestamp, user agent, and actions taken within the tool. This data is processed in accordance with the <strong>RIN Privacy Policy</strong>.</p>

            <p style={{ fontWeight: 700, marginTop: 16 }}>5. Authorized Use Only</p>
            <p>This tool is restricted to authorized RIN personnel. You may not share your login credentials or allow unauthorized access. Any unauthorized use may result in account suspension and legal action.</p>

            <p style={{ fontWeight: 700, marginTop: 16 }}>6. Governing Law</p>
            <p>These terms are governed by the laws of the State of Florida, USA.</p>

            <p style={{ fontWeight: 700, marginTop: 16 }}>7. Acceptance</p>
            <p>By clicking "I Agree" below, you acknowledge that you have read, understood, and agree to be bound by these terms.</p>
          </div>

          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: "#333", marginBottom: 16 }}>
              Logged in as: <span style={{ color: "#0d6efd" }}>{authUser.full_name}</span> ({authUser.company})
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                onClick={handleLogout}
                style={{ padding: "12px 32px", borderRadius: 8, background: "#f8f9fa", color: "#333", fontSize: 15, fontWeight: 600, border: "1px solid #dee2e6", cursor: "pointer", minWidth: 160 }}
              >
                Decline &amp; Logout
              </button>
              <button
                onClick={handleDisclaimerAccept}
                style={{ padding: "12px 32px", borderRadius: 8, background: "#198754", color: "white", fontSize: 15, fontWeight: 600, border: "none", cursor: "pointer", minWidth: 200 }}
              >
                I Agree to These Terms
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", fontFamily: "-apple-system, sans-serif" }}>
        <p>Loading pricing data...</p>
      </div>
    );
  }

  const selectedConfig = pricingConfigs.find(c => c.incident_type_id === selectedIncident);
  const isLuxury = vehicleMake && LUXURY_MAKES.some(m => m.toLowerCase() === vehicleMake.toLowerCase());

  return (
    <div className="pq-container" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", background: "#f8f9fa", minHeight: "100vh" }}>
      <style>{MOBILE_STYLES}</style>
      {/* Header */}
      <div className="pq-header" style={{ background: "#0d6efd", color: "white", padding: "20px 24px", borderRadius: 12, marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28 }}>RIN Price Quote Tool</h1>
          <p style={{ margin: "8px 0 0", opacity: 0.85, fontSize: 14 }}>
            Logged in as <strong>{authUser.full_name}</strong> ({authUser.company})
        </p>
        </div>
        <button
          onClick={handleLogout}
          style={{ padding: "8px 20px", borderRadius: 8, background: "rgba(255,255,255,0.2)", color: "white", fontSize: 13, fontWeight: 600, border: "1px solid rgba(255,255,255,0.3)", cursor: "pointer" }}
        >
          Logout
        </button>
      </div>

      <div className="pq-grid">
        {/* Left: Inputs */}
        <div style={{ background: "#fff", borderRadius: 12, padding: 20, border: "1px solid #dee2e6" }}>
          <h2 style={{ marginTop: 0, fontSize: 18, color: "#333" }}>Job Details</h2>

          <label style={{ display: "block", fontWeight: 600, fontSize: 13, color: "#495057", marginBottom: 4 }}>Service Type</label>
          <select
            value={selectedIncident}
            onChange={e => setSelectedIncident(e.target.value)}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ced4da", fontSize: 15, marginBottom: 16 }}
          >
            {pricingConfigs.map(c => (
              <option key={c.incident_type_id} value={c.incident_type_id}>
                {c.incident_name} &mdash; ${c.base_rate} base
              </option>
            ))}
          </select>

          <label style={{ display: "block", fontWeight: 600, fontSize: 13, color: "#495057", marginBottom: 4 }}>
            Distance: <strong style={{ color: "#0d6efd" }}>{distance} km</strong>
          </label>
          <input
            type="range"
            min={1}
            max={100}
            value={distance}
            onChange={e => setDistance(parseInt(e.target.value))}
            style={{ width: "100%", marginBottom: 4 }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#999", marginBottom: 16 }}>
            <span>1 km</span><span>25 km</span><span>50 km</span><span>75 km</span><span>100 km</span>
          </div>

          <label style={{ display: "block", fontWeight: 600, fontSize: 13, color: "#495057", marginBottom: 4 }}>Vehicle Make</label>
          <select
            value={vehicleMake}
            onChange={e => setVehicleMake(e.target.value)}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${isLuxury ? "#dc3545" : "#ced4da"}`, fontSize: 15, marginBottom: 4, background: isLuxury ? "#fff5f5" : "#fff" }}
          >
            <option value="">-- No vehicle selected --</option>
            <optgroup label="Standard Vehicles">
              {VEHICLE_MAKES.filter(v => !v.luxury).map(v => (
                <option key={v.name} value={v.name}>{v.name}</option>
              ))}
            </optgroup>
            <optgroup label="Luxury / Premium (+25% surcharge)">
              {VEHICLE_MAKES.filter(v => v.luxury).map(v => (
                <option key={v.name} value={v.name}>{v.name}</option>
              ))}
            </optgroup>
          </select>
          {isLuxury && (
            <p style={{ fontSize: 12, color: "#dc3545", fontWeight: 600, margin: "2px 0 16px" }}>
              Luxury vehicle &mdash; 25% surcharge on base rate applies
            </p>
          )}
          {!isLuxury && <div style={{ marginBottom: 16 }} />}

          <label style={{ display: "block", fontWeight: 600, fontSize: 13, color: "#495057", marginBottom: 4 }}>Time of Day</label>
          <select
            value={timeOfDay}
            onChange={e => setTimeOfDay(e.target.value)}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ced4da", fontSize: 15, marginBottom: 16 }}
          >
            <option value="standard">Standard (9am-4pm) &mdash; 1.00x</option>
            <option value="early_morning">Early Morning (6-7am) &mdash; 1.15x</option>
            <option value="peak_morning">Peak Morning (7-9am weekdays) &mdash; 1.25x</option>
            <option value="peak_evening">Peak Evening (4-7pm weekdays) &mdash; 1.25x</option>
            <option value="night">Night (9pm-6am) &mdash; 1.40x</option>
          </select>
        </div>

        {/* Right: Quote Result */}
        <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #dee2e6" }}>
          <h2 style={{ marginTop: 0, fontSize: 18, color: "#333" }}>Price Breakdown</h2>

          {quote && (
            <>
              {/* Final Price */}
              <div style={{ background: "#0d6efd", color: "white", borderRadius: 10, padding: "20px 24px", marginBottom: 20, textAlign: "center" }}>
                <div style={{ fontSize: 42, fontWeight: 700 }}>${quote.final_price.toFixed(2)}</div>
                <div style={{ fontSize: 13, opacity: 0.85 }}>Estimated Price ({selectedConfig?.incident_name})</div>
              </div>

              {/* Line items */}
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <tbody>
                  <tr style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "8px 0", color: "#666" }}>Base Rate</td>
                    <td style={{ padding: "8px 0", textAlign: "right", fontWeight: 600 }}>
                      {quote.base_rate_overridden ? (
                        <><span style={{ textDecoration: "line-through", color: "#999", marginRight: 8 }}>${quote.original_base.toFixed(2)}</span>${quote.base_rate.toFixed(2)} <span style={{ fontSize: 11, color: "#dc3545" }}>(long dist.)</span></>
                      ) : (
                        `$${quote.base_rate.toFixed(2)}`
                      )}
                    </td>
                  </tr>

                  {/* Distance tiers */}
                  {quote.tier_breakdown.map((t, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                      <td style={{ padding: "8px 0", color: "#666", paddingLeft: i === 0 ? 0 : 16 }}>
                        {i === 0 ? "Distance" : ""} <span style={{ fontSize: 12, color: "#999" }}>{t.tier} ({t.km}km x ${t.rate})</span>
                      </td>
                      <td style={{ padding: "8px 0", textAlign: "right", fontWeight: 600 }}>${t.charge.toFixed(2)}</td>
                    </tr>
                  ))}

                  <tr style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "8px 0", color: "#666" }}>Distance Total ({quote.distance_km}km)</td>
                    <td style={{ padding: "8px 0", textAlign: "right", fontWeight: 600 }}>${quote.distance_charge.toFixed(2)}</td>
                  </tr>

                  {quote.luxury_surcharge > 0 && (
                    <tr style={{ borderBottom: "1px solid #eee" }}>
                      <td style={{ padding: "8px 0", color: "#dc3545" }}>Luxury Surcharge (25%)</td>
                      <td style={{ padding: "8px 0", textAlign: "right", fontWeight: 600, color: "#dc3545" }}>+${quote.luxury_surcharge.toFixed(2)}</td>
                    </tr>
                  )}

                  {quote.time_multiplier !== 1.0 && (
                    <tr style={{ borderBottom: "1px solid #eee" }}>
                      <td style={{ padding: "8px 0", color: "#fd7e14" }}>Time Multiplier ({quote.time_period})</td>
                      <td style={{ padding: "8px 0", textAlign: "right", fontWeight: 600, color: "#fd7e14" }}>x{quote.time_multiplier.toFixed(2)}</td>
                    </tr>
                  )}

                  <tr style={{ borderTop: "2px solid #333" }}>
                    <td style={{ padding: "12px 0", fontWeight: 700, fontSize: 16 }}>Total</td>
                    <td style={{ padding: "12px 0", textAlign: "right", fontWeight: 700, fontSize: 16 }}>${quote.final_price.toFixed(2)}</td>
                  </tr>

                  <tr style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "6px 0", color: "#999", fontSize: 12 }}>Cancellation Fee (50%)</td>
                    <td style={{ padding: "6px 0", textAlign: "right", color: "#999", fontSize: 12 }}>${quote.cancellation_fee.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "6px 0", color: "#999", fontSize: 12 }}>Minimum Fee</td>
                    <td style={{ padding: "6px 0", textAlign: "right", color: "#999", fontSize: 12 }}>${quote.min_fee.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>

              {/* Formula */}
              <div style={{ marginTop: 20, background: "#f1f3f5", borderRadius: 8, padding: 16, fontSize: 13, fontFamily: "monospace" }}>
                <strong>Formula:</strong><br />
                ({quote.base_rate_overridden ? `$${quote.base_rate} override` : `$${quote.base_rate} base`}
                {" + "}${quote.distance_charge} distance
                {quote.luxury_surcharge > 0 ? ` + $${quote.luxury_surcharge} luxury` : ""}
                ){quote.time_multiplier !== 1.0 ? ` x ${quote.time_multiplier}` : ""}
                {" = "}
                <strong>${quote.final_price.toFixed(2)}</strong>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Reference Tables Toggle */}
      <div style={{ marginTop: 24, textAlign: "center" }}>
        <button
          onClick={() => setShowReference(!showReference)}
          style={{ padding: "10px 24px", borderRadius: 8, background: showReference ? "#6c757d" : "#fff", color: showReference ? "#fff" : "#495057", fontSize: 14, fontWeight: 600, border: "1px solid #dee2e6", cursor: "pointer" }}
        >
          {showReference ? "Hide Reference Tables" : "View Reference Tables"}
        </button>
      </div>

      {showReference && (
      <div className="pq-ref-table" style={{ marginTop: 16, background: "#fff", borderRadius: 12, padding: 20, border: "1px solid #dee2e6" }}>
        <h2 style={{ marginTop: 0, fontSize: 18, color: "#333" }}>Reference: All Pricing Data</h2>

        <h3 style={{ fontSize: 15, color: "#495057" }}>Service Types &amp; Base Rates</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#e9ecef" }}>
              <th style={{ padding: "8px 10px", textAlign: "left" }}>Service</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>Base Rate</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>Per-km (fallback)</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>Min Fee</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>Cancel %</th>
            </tr>
          </thead>
          <tbody>
            {pricingConfigs.map(c => (
              <tr key={c.incident_type_id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "6px 10px" }}>{c.incident_name}</td>
                <td style={{ padding: "6px 10px", textAlign: "right" }}>${c.base_rate.toFixed(2)}</td>
                <td style={{ padding: "6px 10px", textAlign: "right" }}>${c.per_km_rate.toFixed(2)}</td>
                <td style={{ padding: "6px 10px", textAlign: "right" }}>${c.min_fee.toFixed(2)}</td>
                <td style={{ padding: "6px 10px", textAlign: "right" }}>{c.cancellation_fee_pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 style={{ fontSize: 15, color: "#495057", marginTop: 24 }}>Distance Tiers</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#e9ecef" }}>
              <th style={{ padding: "8px 10px", textAlign: "left" }}>Tier</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>Range</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>Rate</th>
            </tr>
          </thead>
          <tbody>
            {distanceTiers.map(t => (
              <tr key={t.tier_name} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "6px 10px" }}>{t.tier_name}</td>
                <td style={{ padding: "6px 10px", textAlign: "right" }}>{t.min_km} &ndash; {t.max_km ? `${t.max_km} km` : "unlimited"}</td>
                <td style={{ padding: "6px 10px", textAlign: "right" }}>${t.per_km_rate.toFixed(2)}/km</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 style={{ fontSize: 15, color: "#495057", marginTop: 24 }}>Time Multipliers</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#e9ecef" }}>
              <th style={{ padding: "8px 10px", textAlign: "left" }}>Period</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>Hours</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>Multiplier</th>
            </tr>
          </thead>
          <tbody>
            {multipliers.sort((a, b) => a.multiplier - b.multiplier).map(m => (
              <tr key={m.name} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "6px 10px" }}>{m.name.replace(/_/g, " ")}</td>
                <td style={{ padding: "6px 10px", textAlign: "right" }}>{m.start_hour}:00 &ndash; {m.end_hour}:00</td>
                <td style={{ padding: "6px 10px", textAlign: "right" }}>{m.multiplier.toFixed(2)}x</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 style={{ fontSize: 15, color: "#495057", marginTop: 24 }}>Long Distance Overrides</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#e9ecef" }}>
              <th style={{ padding: "8px 10px", textAlign: "left" }}>Service</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>Trigger</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>Override Base</th>
            </tr>
          </thead>
          <tbody>
            {overrides.map((o, i) => {
              const config = pricingConfigs.find(c => c.incident_type_id === o.incident_type_id);
              return (
                <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: "6px 10px" }}>{config?.incident_name || "Unknown"}</td>
                  <td style={{ padding: "6px 10px", textAlign: "right" }}>&gt; {o.min_distance_km} km</td>
                  <td style={{ padding: "6px 10px", textAlign: "right" }}>${o.base_rate_override.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      <footer style={{ marginTop: 32, textAlign: "center", color: "#999", fontSize: 12, padding: 16 }}>
        RIN Roadside Intelligence Network &mdash; Private Pricing Verification Tool<br />
        Data loaded live from Supabase &mdash; Last refreshed on page load
      </footer>
    </div>
  );
}
