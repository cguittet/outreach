export interface User { id: string; email: string; displayName: string }
export interface Step { id: string; stepOrder: number; kind: "message" | "follow_up"; name: string; delayBusinessDays: number; template: string }
export interface Action {
  id: string; actionType: string; dueAt: string; label: string; message: string;
  prospect: { id: string; name: string; company: string; jobTitle: string; linkedinUrl: string };
  step?: Step | null;
}
export interface Prospect {
  id: string; linkedinUrl: string; name: string; jobTitle: string; company: string; companySize: string;
  connectionStatus: string; workflowStatus: string; notes: string; updatedAt: string;
  nextAction?: (Action & { step?: Step | null }) | null;
  mutualContacts?: Array<{ id?: string; name: string; linkedinUrl?: string }>;
  activities?: Array<{ id: string; type: string; content: string; occurredAt: string }>;
}
