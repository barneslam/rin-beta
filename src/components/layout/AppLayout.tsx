import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { JobHeader } from "./JobHeader";
import { StepIndicator } from "./StepIndicator";
import { JobProvider } from "@/context/JobContext";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <JobProvider>
      <SidebarProvider>
        <div className="min-h-screen flex w-full">
          <AppSidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <header className="h-10 flex items-center border-b bg-card px-2 shrink-0">
              <SidebarTrigger className="mr-2" />
              <span className="text-xs font-medium text-muted-foreground">RIN Dispatch Console</span>
            </header>
            <JobHeader />
            <StepIndicator />
            <main className="flex-1 p-6 overflow-auto">{children}</main>
          </div>
        </div>
      </SidebarProvider>
    </JobProvider>
  );
}
