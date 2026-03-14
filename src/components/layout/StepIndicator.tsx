import { useLocation } from "react-router-dom";
import { JOB_STEPS } from "@/types/rin";
import { cn } from "@/lib/utils";

export function StepIndicator() {
  const location = useLocation();
  const currentStep = JOB_STEPS.find((s) => s.path === location.pathname);
  const currentIdx = currentStep ? currentStep.step - 1 : -1;

  return (
    <div className="flex items-center gap-1 px-6 py-2 border-b bg-card/50">
      {JOB_STEPS.map((step, i) => (
        <div key={step.key} className="flex items-center">
          <div
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors duration-75",
              i === currentIdx
                ? "bg-primary text-primary-foreground font-medium"
                : i < currentIdx
                ? "text-success font-medium"
                : "text-muted-foreground"
            )}
          >
            <span className="font-mono text-[10px]">{step.step}</span>
            <span className="hidden sm:inline">{step.label}</span>
          </div>
          {i < JOB_STEPS.length - 1 && (
            <div
              className={cn(
                "w-4 h-px mx-0.5",
                i < currentIdx ? "bg-success" : "bg-border"
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}
