import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";

// Customer pages
import Landing from "./pages/Landing";
import GetHelpChoice from "./pages/GetHelpChoice";
import CustomerChatIntake from "./pages/CustomerChatIntake";
import CustomerFormIntake from "./pages/CustomerFormIntake";
import CustomerVoiceIntake from "./pages/CustomerVoiceIntake";
import CustomerTracking from "./pages/CustomerTracking";
import CustomerPayment from "./pages/CustomerPayment";

// Dispatcher pages
import IncidentIntake from "./pages/IncidentIntake";
import IncidentValidation from "./pages/IncidentValidation";
import DispatchDecision from "./pages/DispatchDecision";
import PricingAuth from "./pages/PricingAuth";
import DriverMatching from "./pages/DriverMatching";
import DriverOffer from "./pages/DriverOffer";
import JobTracking from "./pages/JobTracking";
import DispatchControlPanel from "./pages/DispatchControlPanel";
import DispatchDiagnostics from "./pages/DispatchDiagnostics";
import DriverOfferPublic from "./pages/DriverOfferPublic";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function DispatcherLayout({ children }: { children: React.ReactNode }) {
  return <AppLayout>{children}</AppLayout>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* Customer routes — full-screen, no sidebar */}
          <Route path="/" element={<Landing />} />
          <Route path="/get-help" element={<GetHelpChoice />} />
          <Route path="/get-help/chat" element={<CustomerChatIntake />} />
          <Route path="/get-help/form" element={<CustomerFormIntake />} />
          <Route path="/get-help/voice" element={<CustomerVoiceIntake />} />
          <Route path="/track/:jobId" element={<CustomerTracking />} />
          <Route path="/pay/:jobId" element={<CustomerPayment />} />
          <Route path="/driver/offer/:offerId" element={<DriverOfferPublic />} />

          {/* Dispatcher routes — with sidebar */}
          <Route path="/intake" element={<DispatcherLayout><IncidentIntake /></DispatcherLayout>} />
          <Route path="/validation" element={<DispatcherLayout><IncidentValidation /></DispatcherLayout>} />
          <Route path="/dispatch" element={<DispatcherLayout><DispatchDecision /></DispatcherLayout>} />
          <Route path="/pricing" element={<DispatcherLayout><PricingAuth /></DispatcherLayout>} />
          <Route path="/matching" element={<DispatcherLayout><DriverMatching /></DispatcherLayout>} />
          <Route path="/offer" element={<DispatcherLayout><DriverOffer /></DispatcherLayout>} />
          <Route path="/tracking" element={<DispatcherLayout><JobTracking /></DispatcherLayout>} />
          <Route path="/control-panel" element={<DispatcherLayout><DispatchControlPanel /></DispatcherLayout>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
