export type QuestionStatus = "pending" | "answered" | "timeout";

export interface Question {
  id: string;
  content: string;
  predefinedAnswers: string[];
  /** When true, chips toggle and multiple selections are stored. */
  allowMultiple?: boolean;
  /** When true, empty answer is allowed (e.g. closing free-text). */
  optional?: boolean;
  status: QuestionStatus;
  /** Display / primary answer. Multi-select joins with ", ". */
  answer?: string;
  /** Selected chip values when allowMultiple (also mirrored in answer). */
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

export interface StoreData {
  sessions: Session[];
}
