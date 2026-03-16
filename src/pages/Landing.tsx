import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Phone } from "lucide-react";

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-sidebar-background flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-md flex flex-col items-center text-center space-y-10">
        {/* Branding */}
        <div className="space-y-3">
          <h1 className="text-4xl font-bold tracking-tight text-sidebar-foreground">
            RIN
          </h1>
          <p className="text-lg text-sidebar-accent-foreground/70">
            Roadside assistance, fast.
          </p>
        </div>

        {/* CTA */}
        <Button
          onClick={() => navigate("/get-help")}
          size="lg"
          className="w-full h-16 text-xl font-semibold rounded-2xl bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/25 transition-all active:scale-[0.98]"
        >
          <Phone className="w-6 h-6 mr-2" />
          Get Help Now
        </Button>

        {/* Subtle footer */}
        <p className="text-xs text-sidebar-accent-foreground/40">
          Available 24/7 · Towing · Jump starts · Lockouts · More
        </p>
      </div>
    </div>
  );
}
