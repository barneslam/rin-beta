import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Send, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useCreateJob } from "@/hooks/useJobs";
import { useIncidentTypes } from "@/hooks/useReferenceData";
import { useAutoDispatchPipeline } from "@/hooks/useAutoDispatchPipeline";
import { createCustomerUser } from "@/hooks/useCreateCustomerUser";
import { toast } from "sonner";
import type { IntakePayload } from "@/types/intake";
import { createBlankPayload } from "@/types/intake";
import { processIntakePayload, matchIncidentTypeId } from "@/lib/intakeProcessor";

type Msg = { role: "user" | "assistant"; content: string };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/roadside-chat`;

export default function CustomerChatIntake() {
  const navigate = useNavigate();
  const createJob = useCreateJob();
  const autoDispatch = useAutoDispatchPipeline();
  const { data: incidentTypes } = useIncidentTypes();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [jobCreated, setJobCreated] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    sendToAI([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleToolCall(args: Record<string, unknown>) {
    // Build canonical IntakePayload from AI tool call
    const payload: IntakePayload = {
      ...createBlankPayload("chat"),
      incident_description: String(args.incident_description || ""),
      location_text: String(args.location || ""),
      vehicle_make: args.vehicle_make ? String(args.vehicle_make) : "",
      vehicle_model: args.vehicle_model ? String(args.vehicle_model) : "",
      vehicle_year: args.vehicle_year ? Number(args.vehicle_year) : null,
      drivable: args.drivable != null ? Boolean(args.drivable) : null,
      tow_required: args.tow_required != null ? Boolean(args.tow_required) : null,
      destination_text: args.destination ? String(args.destination) : null,
      caller_name: args.caller_name ? String(args.caller_name) : "",
      caller_phone: args.caller_phone ? String(args.caller_phone) : "",
      language: args.language ? String(args.language) : "en",
      field_confidence: {
        incident: "high",
        location: args.location ? "medium" : "low",
        vehicle: args.vehicle_make ? "high" : "low",
        drivable: args.drivable != null ? "high" : "low",
      },
    };

    // Process: geocode + validate
    const result = await processIntakePayload(payload);

    if (!result.ready) {
      // Missing fields — ask AI to follow up instead of creating the job
      const missingLabels = result.missingFieldLabels.join(", ");
      const followUpMsg: Msg = {
        role: "user",
        content: `[System: The following information is still needed before we can create the request: ${missingLabels}. Please ask the caller for these details.]`,
      };
      const updatedMessages = [...messages, followUpMsg];
      // Don't show system message to user, just send to AI
      await sendToAI(updatedMessages);
      return;
    }

    // Payload is ready — create the job
    setJobCreated(true);
    try {
      const processed = result.payload;
      const incidentTypeId = matchIncidentTypeId(
        processed.incident_description,
        incidentTypes || []
      );

      const userId = await createCustomerUser({
        name: processed.caller_name || "Customer",
        phone: processed.caller_phone || undefined,
        vehicleMake: processed.vehicle_make || undefined,
        vehicleModel: processed.vehicle_model || undefined,
        vehicleYear: processed.vehicle_year ?? undefined,
      });

      const job = await createJob.mutateAsync({
        job_status: "intake_started",
        pickup_location: processed.location_text,
        gps_lat: processed.location_lat,
        gps_long: processed.location_lng,
        vehicle_make: processed.vehicle_make || null,
        vehicle_model: processed.vehicle_model || null,
        vehicle_year: processed.vehicle_year,
        vehicle_condition: processed.incident_description,
        can_vehicle_roll: processed.drivable,
        incident_type_id: incidentTypeId,
        user_id: userId,
        language: processed.language,
      } as any);

      try {
        await autoDispatch.mutateAsync(job.job_id);
      } catch (e) {
        console.warn("Auto-dispatch failed, job created but needs manual dispatch:", e);
      }
      setTimeout(() => navigate(`/track/${job.job_id}`), 1500);
    } catch {
      toast.error("Something went wrong creating your request.");
      setJobCreated(false);
    }
  }

  async function sendToAI(conversationMessages: Msg[]) {
    setIsLoading(true);
    let assistantSoFar = "";

    const upsertAssistant = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
        }
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    try {
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: conversationMessages }),
      });

      if (resp.status === 429) {
        toast.error("We're experiencing high demand. Please try again in a moment.");
        setIsLoading(false);
        return;
      }
      if (resp.status === 402) {
        toast.error("Service temporarily unavailable. Please try the form instead.");
        setIsLoading(false);
        return;
      }
      if (!resp.ok || !resp.body) {
        toast.error("Connection issue. Please try again.");
        setIsLoading(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let streamDone = false;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") { streamDone = true; break; }

          try {
            const parsed = JSON.parse(jsonStr);
            const choice = parsed.choices?.[0];

            const toolCall = choice?.delta?.tool_calls?.[0];
            if (toolCall?.function?.arguments) {
              assistantSoFar = "";
              try {
                const args = JSON.parse(toolCall.function.arguments);
                if (toolCall.function.name === "create_roadside_job" || Object.keys(args).includes("incident_description")) {
                  upsertAssistant("Connecting you to help...");
                  await handleToolCall(args);
                  setIsLoading(false);
                  return;
                }
              } catch {
                // Partial tool call JSON, continue accumulating
              }
            }

            if (choice?.finish_reason === "tool_calls") {
              continue;
            }

            const content = choice?.delta?.content as string | undefined;
            if (content) upsertAssistant(content);
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      // Final flush
      if (textBuffer.trim()) {
        for (let raw of textBuffer.split("\n")) {
          if (!raw) continue;
          if (raw.endsWith("\r")) raw = raw.slice(0, -1);
          if (raw.startsWith(":") || raw.trim() === "") continue;
          if (!raw.startsWith("data: ")) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) upsertAssistant(content);
          } catch { /* ignore */ }
        }
      }
    } catch {
      toast.error("Connection lost. Please try again.");
    }
    setIsLoading(false);
  }

  async function handleSend() {
    if (!input.trim() || isLoading || jobCreated) return;
    const userMsg: Msg = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    await sendToAI(newMessages);
  }

  if (jobCreated) {
    return (
      <div className="min-h-screen bg-sidebar-background flex flex-col items-center justify-center px-6">
        <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
        <p className="text-xl font-semibold text-sidebar-foreground">Connecting you to help...</p>
        <p className="text-sm text-sidebar-accent-foreground/60 mt-2">We're finding the nearest driver</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-sidebar-background flex flex-col">
      <div className="p-4 flex items-center gap-3 border-b border-sidebar-border shrink-0">
        <button onClick={() => navigate("/get-help")} className="text-sidebar-accent-foreground/50 hover:text-sidebar-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-lg font-semibold text-sidebar-foreground">RIN</h1>
          <p className="text-xs text-sidebar-accent-foreground/50">Roadside Assistant</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-md"
                  : "bg-sidebar-accent text-sidebar-foreground rounded-bl-md"
              }`}
            >
              {m.role === "assistant" ? (
                <div className="prose prose-sm prose-invert max-w-none">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}
        {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex justify-start">
            <div className="bg-sidebar-accent text-sidebar-foreground px-4 py-3 rounded-2xl rounded-bl-md">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="p-4 border-t border-sidebar-border shrink-0">
        <div className="flex gap-2 max-w-md mx-auto">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="Describe what happened..."
            className="flex-1 h-12 px-4 rounded-xl bg-sidebar-accent border border-sidebar-border text-sidebar-foreground placeholder:text-sidebar-accent-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary text-sm"
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="w-12 h-12 rounded-xl bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-40 transition-all active:scale-95 shrink-0"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
