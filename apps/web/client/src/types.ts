export interface User { id: string; email: string; displayName: string }
export interface Step { id: string; stageId?: string; stepOrder: number; kind: "message" | "follow_up"; trigger: "entry" | "reply" | "no_reply"; name: string; delayBusinessDays: number; template: string }
export interface Stage { id: string; name: string; stageKey?: string | null; stageOrder: number; archivedAt?: string | null; steps: Step[] }
export interface WorkflowData { id: string; name: string; finalWaitBusinessDays: number; stages: Stage[] }
export interface Action {
  id: string; actionType: string; dueAt: string; label: string; message: string;
  prospect: { id: string; name: string; company: string; jobTitle: string; linkedinUrl: string };
  step?: Step | null;
}
export interface Prospect {
  id: string; linkedinUrl: string; name: string; jobTitle: string; company: string; companySize: string;
  connectionStatus: string; workflowStatus: string; trackingStatus: "open" | "paused" | "closed"; notes: string; createdAt: string; updatedAt: string; lastInteractedAt?: string | null;
  stage?: Stage | null;
  nextAction?: (Action & { step?: Step | null }) | null;
  mutualContacts?: Array<{ id?: string; name: string; linkedinUrl?: string }>;
  activities?: Array<{ id: string; type: string; content: string; occurredAt: string }>;
  stageHistory?: Array<{ id: string; reason: string; occurredAt: string; stage: Stage }>;
}
