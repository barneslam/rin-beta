import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
import IncidentIntake from "./pages/IncidentIntake";
import IncidentValidation from "./pages/IncidentValidation";
import DispatchDecision from "./pages/DispatchDecision";
import PricingAuth from "./pages/PricingAuth";
import DriverMatching from "./pages/DriverMatching";
import DriverOffer from "./pages/DriverOffer";
import JobTracking from "./pages/JobTracking";
import DispatchControlPanel from "./pages/DispatchControlPanel";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppLayout>
          <Routes>
            <Route path="/" element={<Navigate to="/intake" replace />} />
            <Route path="/intake" element={<IncidentIntake />} />
            <Route path="/validation" element={<IncidentValidation />} />
            <Route path="/dispatch" element={<DispatchDecision />} />
            <Route path="/pricing" element={<PricingAuth />} />
            <Route path="/matching" element={<DriverMatching />} />
            <Route path="/offer" element={<DriverOffer />} />
            <Route path="/tracking" element={<JobTracking />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AppLayout>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
