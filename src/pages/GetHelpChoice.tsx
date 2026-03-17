import { useNavigate } from "react-router-dom";
import { MessageCircle, Keyboard, Phone, ArrowLeft } from "lucide-react";

export default function GetHelpChoice() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-sidebar-background flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-md flex flex-col items-center space-y-8">
        <h1 className="text-2xl font-semibold text-sidebar-foreground text-center">
          How would you like to get help?
        </h1>

        <div className="w-full space-y-4">
          {/* Primary: Chat with RIN */}
          <button
            onClick={() => navigate("/get-help/chat")}
            className="w-full flex items-center gap-4 p-5 rounded-2xl bg-primary text-primary-foreground hover:bg-primary/90 transition-all active:scale-[0.98] shadow-lg shadow-primary/20"
          >
            <div className="w-12 h-12 rounded-xl bg-primary-foreground/15 flex items-center justify-center shrink-0">
              <MessageCircle className="w-6 h-6" />
            </div>
            <div className="text-left">
              <p className="text-lg font-semibold">Chat with RIN</p>
              <p className="text-sm opacity-80">Tell us what happened — we'll handle the rest</p>
            </div>
          </button>

          {/* Secondary: Type instead */}
          <button
            onClick={() => navigate("/get-help/form")}
            className="w-full flex items-center gap-4 p-5 rounded-2xl border border-sidebar-border bg-sidebar-accent text-sidebar-foreground hover:bg-sidebar-accent/80 transition-all active:scale-[0.98]"
          >
            <div className="w-12 h-12 rounded-xl bg-sidebar-border flex items-center justify-center shrink-0">
              <Keyboard className="w-6 h-6" />
            </div>
            <div className="text-left">
              <p className="text-lg font-semibold">Type instead</p>
              <p className="text-sm text-sidebar-accent-foreground/70">Fill out a quick form</p>
            </div>
          </button>

          {/* Tertiary: Call RIN */}
          <button
            onClick={() => navigate("/get-help/voice")}
            className="w-full flex items-center gap-4 p-5 rounded-2xl border border-sidebar-border bg-sidebar-accent text-sidebar-foreground hover:bg-sidebar-accent/80 transition-all active:scale-[0.98]"
          >
            <div className="w-12 h-12 rounded-xl bg-sidebar-border flex items-center justify-center shrink-0">
              <Phone className="w-6 h-6" />
            </div>
            <div className="text-left">
              <p className="text-lg font-semibold">Call RIN</p>
              <p className="text-sm text-sidebar-accent-foreground/70">Call for guided roadside help</p>
            </div>
          </button>
        </div>

        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-sm text-sidebar-accent-foreground/50 hover:text-sidebar-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
      </div>
    </div>
  );
}
