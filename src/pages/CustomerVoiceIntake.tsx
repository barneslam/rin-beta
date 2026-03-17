import { useNavigate } from "react-router-dom";
import { Phone, ArrowLeft } from "lucide-react";

export default function CustomerVoiceIntake() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-sidebar-background flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-md flex flex-col items-center space-y-8">
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
          <Phone className="w-10 h-10 text-primary" />
        </div>

        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold text-sidebar-foreground">
            Call for Roadside Help
          </h1>
          <p className="text-sm text-sidebar-accent-foreground/70">
            Call the number below. Our AI will guide you through a few short questions to get help on the way.
          </p>
        </div>

        <a
          href="tel:+1XXXXXXXXXX"
          className="flex items-center gap-3 px-8 py-4 rounded-2xl bg-primary text-primary-foreground text-xl font-semibold hover:bg-primary/90 transition-all active:scale-[0.98] shadow-lg shadow-primary/20"
        >
          <Phone className="w-6 h-6" />
          Call RIN
        </a>

        <div className="bg-sidebar-accent/50 rounded-2xl p-4 border border-sidebar-border w-full space-y-2">
          <p className="text-xs text-sidebar-accent-foreground/50 font-medium uppercase tracking-wider">
            How it works
          </p>
          <ul className="text-sm text-sidebar-accent-foreground/70 space-y-1 list-disc list-inside">
            <li>Answer a few guided questions about your situation</li>
            <li>We'll find and dispatch the nearest available driver</li>
            <li>You'll receive a text with tracking and payment links</li>
          </ul>
        </div>

        <button
          onClick={() => navigate("/get-help")}
          className="flex items-center gap-2 text-sm text-sidebar-accent-foreground/50 hover:text-sidebar-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
      </div>
    </div>
  );
}
