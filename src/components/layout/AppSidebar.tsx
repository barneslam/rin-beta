import {
  ClipboardList,
  CheckCircle,
  Radio,
  DollarSign,
  Users,
  Send,
  MapPin,
  LayoutDashboard,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";

const steps = [
  { title: "Incident Intake", url: "/intake", icon: ClipboardList, step: 1 },
  { title: "Validation", url: "/validation", icon: CheckCircle, step: 2 },
  { title: "Dispatch Decision", url: "/dispatch", icon: Radio, step: 3 },
  { title: "Pricing & Auth", url: "/pricing", icon: DollarSign, step: 4 },
  { title: "Driver Matching", url: "/matching", icon: Users, step: 5 },
  { title: "Driver Offer", url: "/offer", icon: Send, step: 6 },
  { title: "Job Tracking", url: "/tracking", icon: MapPin, step: 7 },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded bg-sidebar-primary flex items-center justify-center">
              <span className="text-sidebar-primary-foreground font-bold text-sm">R</span>
            </div>
            <div>
              <h1 className="font-bold text-sm text-sidebar-foreground">RIN</h1>
              <p className="text-[10px] text-sidebar-foreground/60">Roadside Intelligent Network</p>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="h-8 w-8 rounded bg-sidebar-primary flex items-center justify-center mx-auto">
            <span className="text-sidebar-primary-foreground font-bold text-sm">R</span>
          </div>
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50 text-[10px] uppercase tracking-wider">
            Job Flow
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {steps.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end
                      className="hover:bg-sidebar-accent/50 transition-colors duration-75"
                      activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sidebar-accent text-[10px] font-mono font-medium text-sidebar-foreground/70">
                          {item.step}
                        </span>
                        <item.icon className="h-4 w-4 shrink-0" />
                      </div>
                      {!collapsed && <span className="text-sm">{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
