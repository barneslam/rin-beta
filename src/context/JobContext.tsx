import React, { createContext, useContext, useState } from "react";

interface JobContextType {
  activeJobId: string | null;
  setActiveJobId: (id: string | null) => void;
}

const JobContext = createContext<JobContextType>({
  activeJobId: null,
  setActiveJobId: () => {},
});

export function JobProvider({ children }: { children: React.ReactNode }) {
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  return (
    <JobContext.Provider value={{ activeJobId, setActiveJobId }}>
      {children}
    </JobContext.Provider>
  );
}

export function useActiveJob() {
  return useContext(JobContext);
}
