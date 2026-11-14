export type QuestionStatus = "pending" | "answered" | "timeout";

export interface Question {
  id: string;
  content: string;
  predefinedAnswers: string[];
  allowMultiple?: boolean;
  optional?: boolean;
  status: QuestionStatus;
  answer?: string;
  selectedAnswers?: string[];
  extras?: string;
  createdAt: string;
  expiresAt: string;
  answeredAt?: string;
}

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  questions: Question[];
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: QuestionStatus;
  questionPreview: string;
  questionCount?: number;
  pendingCount?: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return body;
}

export function listSessions(): Promise<{ sessions: SessionSummary[] }> {
  return request("/api/sessions");
}

export function getSession(id: string): Promise<{ session: Session }> {
  return request(`/api/sessions/${encodeURIComponent(id)}`);
}

export function submitAnswer(
  sessionId: string,
  payload: {
    questionId: string;
    answer: string;
    extras?: string;
    selectedAnswers?: string[];
  },
): Promise<{ session: Session; question: Question }> {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}/answer`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
