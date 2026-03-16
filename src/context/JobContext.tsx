import React, { createContext, useContext, useState, useCallback } from "react";

interface JobContextType {
  activeJobId: string | null;
  setActiveJobId: (id: string | null) => void;
}

const JobContext = createContext<JobContextType>({
  activeJobId: null,
  setActiveJobId: () => {},
});

export function JobProvider({ children }: { children: React.ReactNode }) {
  const [activeJobId, setActiveJobIdState] = useState<string | null>(
    () => sessionStorage.getItem("activeJobId") ?? null
  );

  const setActiveJobId = useCallback((id: string | null) => {
    setActiveJobIdState(id);
    if (id) {
      sessionStorage.setItem("activeJobId", id);
    } else {
      sessionStorage.removeItem("activeJobId");
    }
  }, []);

  return (
    <JobContext.Provider value={{ activeJobId, setActiveJobId }}>
      {children}
    </JobContext.Provider>
  );
}

export function useActiveJob() {
  return useContext(JobContext);
}
