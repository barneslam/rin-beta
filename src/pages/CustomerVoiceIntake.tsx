import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Mic, MicOff, Phone, PhoneOff, Volume2 } from "lucide-react";
import { useConversation } from "@elevenlabs/react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useCreateJob } from "@/hooks/useJobs";
import { useIncidentTypes } from "@/hooks/useReferenceData";
import { useAutoDispatchPipeline } from "@/hooks/useAutoDispatchPipeline";
import { createCustomerUser } from "@/hooks/useCreateCustomerUser";
import { toast } from "sonner";
import type { IntakePayload } from "@/types/intake";
import { createBlankPayload } from "@/types/intake";
import { processIntakePayload, matchIncidentTypeId } from "@/lib/intakeProcessor";

const AGENT_ID = ""; // Set your ElevenLabs agent ID here

export default function CustomerVoiceIntake() {
  const navigate = useNavigate();
  const createJob = useCreateJob();
  const autoDispatch = useAutoDispatchPipeline();
  const { data: incidentTypes } = useIncidentTypes();

  const [isConnecting, setIsConnecting] = useState(false);
  const [jobCreated, setJobCreated] = useState(false);
  const [transcript, setTranscript] = useState<Array<{ role: string; text: string }>>([]);
  const [agentIdInput, setAgentIdInput] = useState(AGENT_ID);

  const handleJobCreation = useCallback(
    async (params: Record<string, unknown>) => {
      if (jobCreated) return "Job already created";

      try {
        const payload: IntakePayload = {
          ...createBlankPayload("voice"),
          incident_description: (params.incident_description as string) || "",
          incident_type: (params.incident_type as string) || null,
          location_text: (params.location as string) || "",
          vehicle_make: (params.vehicle_make as string) || "",
          vehicle_model: (params.vehicle_model as string) || "",
          vehicle_year: params.vehicle_year ? Number(params.vehicle_year) : null,
          drivable: params.drivable != null ? Boolean(params.drivable) : null,
          tow_required: params.tow_required != null ? Boolean(params.tow_required) : null,
          destination_text: (params.destination as string) || null,
          caller_name: (params.caller_name as string) || "Voice Customer",
          caller_phone: (params.caller_phone as string) || "",
          language: (params.language as string) || "en",
          intake_source: "voice",
        };

        const processed = await processIntakePayload(payload);
        if (!processed.ready) {
          return `Missing required information: ${processed.missingFields.join(", ")}. Please ask the customer for these details.`;
        }

        const user = await createCustomerUser({
          name: processed.payload.caller_name,
          phone: processed.payload.caller_phone,
        });

        const incidentTypeId = matchIncidentTypeId(
          processed.payload.incident_type,
          incidentTypes ?? []
        );

        const jobData: any = {
          pickup_location: processed.payload.location_text,
          gps_lat: processed.payload.location_lat,
          gps_long: processed.payload.location_lng,
          vehicle_make: processed.payload.vehicle_make,
          vehicle_model: processed.payload.vehicle_model,
          vehicle_year: processed.payload.vehicle_year,
          can_vehicle_roll: processed.payload.drivable,
          incident_type_id: incidentTypeId,
          language: processed.payload.language,
          user_id: user.user_id,
          job_status: "intake_completed",
          location_type: processed.payload.location_type,
        };

        const job = await createJob.mutateAsync(jobData);
        setJobCreated(true);

        toast.success("Job created — finding a driver");
        autoDispatch.mutate(job.job_id, {
          onSuccess: (result) => {
            if (result.escalated) {
              navigate(`/track/${job.job_id}`);
            } else {
              navigate(`/track/${job.job_id}`);
            }
          },
          onError: () => navigate(`/track/${job.job_id}`),
        });

        return "Job has been created successfully. A driver is being dispatched to your location. You can hang up now.";
      } catch (err) {
        console.error("Voice job creation error:", err);
        return "There was an error creating the job. Please try again or use our chat option.";
      }
    },
    [jobCreated, createJob, autoDispatch, incidentTypes, navigate]
  );

  const conversation = useConversation({
    clientTools: {
      create_roadside_job: async (params: Record<string, unknown>) => {
        const result = await handleJobCreation(params);
        return result;
      },
    },
    onMessage: (message) => {
      if (message.type === "user_transcript") {
        const event = message as any;
        const text = event.user_transcription_event?.user_transcript;
        if (text) {
          setTranscript((prev) => [...prev, { role: "user", text }]);
        }
      } else if (message.type === "agent_response") {
        const event = message as any;
        const text = event.agent_response_event?.agent_response;
        if (text) {
          setTranscript((prev) => [...prev, { role: "agent", text }]);
        }
      }
    },
    onError: (error) => {
      console.error("Conversation error:", error);
      toast.error("Voice connection error. Please try again.");
    },
  });

  const startConversation = useCallback(async () => {
    const effectiveAgentId = agentIdInput.trim();
    if (!effectiveAgentId) {
      toast.error("Please enter your ElevenLabs Agent ID to continue.");
      return;
    }

    setIsConnecting(true);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });

      const { data, error } = await supabase.functions.invoke(
        "elevenlabs-conversation-token",
        { body: { agent_id: effectiveAgentId } }
      );

      if (error || !data?.token) {
        throw new Error("Failed to get conversation token");
      }

      await conversation.startSession({
        conversationToken: data.token,
        connectionType: "webrtc",
      });
    } catch (err) {
      console.error("Failed to start voice conversation:", err);
      toast.error("Could not start voice call. Check microphone permissions.");
    } finally {
      setIsConnecting(false);
    }
  }, [conversation, agentIdInput]);

  const stopConversation = useCallback(async () => {
    await conversation.endSession();
  }, [conversation]);

  const isConnected = conversation.status === "connected";
  const isSpeaking = conversation.isSpeaking;

  return (
    <div className="min-h-screen bg-sidebar-background flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-md flex flex-col items-center space-y-8">
        <h1 className="text-2xl font-semibold text-sidebar-foreground text-center">
          Voice Dispatcher
        </h1>
        <p className="text-sm text-sidebar-accent-foreground/70 text-center">
          Speak with our AI dispatcher to get roadside help
        </p>

        {/* Agent ID input (for configuration) */}
        {!isConnected && !AGENT_ID && (
          <div className="w-full space-y-2">
            <label className="text-xs text-sidebar-accent-foreground/60">
              ElevenLabs Agent ID
            </label>
            <input
              type="text"
              value={agentIdInput}
              onChange={(e) => setAgentIdInput(e.target.value)}
              placeholder="Enter your agent ID"
              className="w-full px-4 py-2 rounded-xl bg-sidebar-accent border border-sidebar-border text-sidebar-foreground text-sm placeholder:text-sidebar-accent-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        )}

        {/* Voice status indicator */}
        <div className="relative">
          <div
            className={`w-32 h-32 rounded-full flex items-center justify-center transition-all duration-300 ${
              isConnected
                ? isSpeaking
                  ? "bg-primary/20 ring-4 ring-primary/40 animate-pulse"
                  : "bg-primary/10 ring-2 ring-primary/20"
                : "bg-sidebar-accent"
            }`}
          >
            {isConnected ? (
              isSpeaking ? (
                <Volume2 className="w-12 h-12 text-primary animate-pulse" />
              ) : (
                <Mic className="w-12 h-12 text-primary" />
              )
            ) : (
              <Phone className="w-12 h-12 text-sidebar-accent-foreground/50" />
            )}
          </div>

          {isConnected && (
            <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-xs font-medium text-primary bg-sidebar-accent px-3 py-1 rounded-full border border-sidebar-border">
              {isSpeaking ? "RIN is speaking…" : "Listening…"}
            </span>
          )}
        </div>

        {/* Call controls */}
        <div className="flex gap-4">
          {!isConnected ? (
            <Button
              onClick={startConversation}
              disabled={isConnecting}
              className="gap-2 rounded-full px-8 py-6 text-base"
              size="lg"
            >
              <Phone className="w-5 h-5" />
              {isConnecting ? "Connecting…" : "Call RIN"}
            </Button>
          ) : (
            <Button
              onClick={stopConversation}
              variant="destructive"
              className="gap-2 rounded-full px-8 py-6 text-base"
              size="lg"
            >
              <PhoneOff className="w-5 h-5" />
              End Call
            </Button>
          )}
        </div>

        {/* Transcript */}
        {transcript.length > 0 && (
          <div className="w-full max-h-60 overflow-y-auto space-y-3 bg-sidebar-accent/50 rounded-2xl p-4 border border-sidebar-border">
            <p className="text-xs text-sidebar-accent-foreground/50 font-medium uppercase tracking-wider">
              Transcript
            </p>
            {transcript.map((entry, i) => (
              <div key={i} className={`text-sm ${entry.role === "user" ? "text-sidebar-foreground" : "text-primary"}`}>
                <span className="font-medium">{entry.role === "user" ? "You" : "RIN"}:</span>{" "}
                {entry.text}
              </div>
            ))}
          </div>
        )}

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
