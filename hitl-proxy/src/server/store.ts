import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";

import type { Question, QuestionStatus, Session, StoreData } from "./types.js";

const DEFAULT_TIMEOUT_SECONDS = 1800;
/** Absolute max lifetime for any session (pending, answered, or timeout). */
export const SESSION_RETENTION_SECONDS = 3600;
const MAX_SESSIONS = 500;
const MAX_QUESTIONS_PER_SESSION = 20;
/** Always appended as the last step; empty answer is allowed. */
export const AGENT_FOLLOW_UP_QUESTION =
  "Do you have anything else to tell the agent?";

export interface QuestionInput {
  question: string;
  answers?: string[];
  allowMultiple?: boolean;
}

export class SessionStore {
  private data: StoreData = { sessions: [] };
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async init(): Promise<void> {
    if (this.loaded) return;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as StoreData;
      this.data = {
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      };
    } catch {
      this.data = { sessions: [] };
      await this.persist();
    }
    this.loaded = true;
    this.sweep();
  }

  listSessions(): Session[] {
    this.sweep();
    return [...this.data.sessions].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  getSession(id: string): Session | undefined {
    this.sweep();
    return this.data.sessions.find((s) => s.id === id);
  }

  getQuestion(
    questionId: string,
  ): { session: Session; question: Question } | undefined {
    this.sweep();
    for (const session of this.data.sessions) {
      const question = session.questions.find((q) => q.id === questionId);
      if (question) {
        return { session, question };
      }
    }
    return undefined;
  }

  sessionStatus(session: Session): QuestionStatus {
    if (session.questions.some((q) => q.status === "pending")) {
      return "pending";
    }
    if (session.questions.some((q) => q.status === "timeout")) {
      return "timeout";
    }
    return "answered";
  }

  async askQuestions(input: {
    items: QuestionInput[];
    timeoutSeconds?: number;
    title?: string;
  }): Promise<{ session: Session; questions: Question[] }> {
    await this.init();
    this.sweep();

    if (!input.items.length) {
      throw new Error("at least one question is required");
    }
    if (input.items.length > MAX_QUESTIONS_PER_SESSION) {
      throw new Error(
        `at most ${MAX_QUESTIONS_PER_SESSION} questions per session`,
      );
    }

    const now = new Date();
    const timeoutSeconds =
      typeof input.timeoutSeconds === "number" && input.timeoutSeconds > 0
        ? Math.min(input.timeoutSeconds, SESSION_RETENTION_SECONDS)
        : DEFAULT_TIMEOUT_SECONDS;
    const expiresAt = new Date(now.getTime() + timeoutSeconds * 1000);

    const questions: Question[] = input.items.map((item) => {
      const content = item.question.trim();
      if (!content) {
        throw new Error("question is required");
      }
      return {
        id: nanoid(12),
        content,
        predefinedAnswers: (item.answers ?? [])
          .map((a) => a.trim())
          .filter((a) => a.length > 0)
          .slice(0, 20),
        allowMultiple: item.allowMultiple === true,
        optional: false,
        status: "pending" as const,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      };
    });

    const last = questions[questions.length - 1];
    if (
      !last ||
      last.content.trim().toLowerCase() !==
        AGENT_FOLLOW_UP_QUESTION.toLowerCase()
    ) {
      questions.push({
        id: nanoid(12),
        content: AGENT_FOLLOW_UP_QUESTION,
        predefinedAnswers: [],
        allowMultiple: false,
        optional: true,
        status: "pending",
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });
    } else {
      last.optional = true;
      last.predefinedAnswers = [];
      last.allowMultiple = false;
    }

    const agentCount = questions.filter((q) => q.optional !== true).length;
    const titleSource =
      input.title?.trim() ||
      (agentCount === 1
        ? (questions.find((q) => !q.optional)?.content ?? questions[0].content)
        : `${agentCount} questions`);
    const title =
      titleSource.slice(0, 80) + (titleSource.length > 80 ? "…" : "");

    const session: Session = {
      id: nanoid(12),
      title,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      questions,
    };

    this.data.sessions.unshift(session);
    if (this.data.sessions.length > MAX_SESSIONS) {
      this.data.sessions = this.data.sessions.slice(0, MAX_SESSIONS);
    }
    await this.persist();
    return { session, questions };
  }

  async answerQuestion(
    sessionId: string,
    questionId: string,
    answer: string,
    extras?: string,
    selectedAnswers?: string[],
  ): Promise<{ session: Session; question: Question }> {
    await this.init();
    this.sweep();

    const session = this.data.sessions.find((s) => s.id === sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
    const question = session.questions.find((q) => q.id === questionId);
    if (!question) {
      throw new Error("Question not found");
    }
    if (question.status === "answered") {
      throw new Error("Answer is locked and cannot be changed");
    }

    if (
      question.allowMultiple &&
      selectedAnswers &&
      selectedAnswers.length > 0
    ) {
      const selected = selectedAnswers
        .map((a) => a.trim())
        .filter((a) => a.length > 0);
      if (selected.length === 0 && !question.optional) {
        throw new Error("at least one answer is required");
      }
      question.selectedAnswers = selected;
      question.answer = selected.join(", ");
    } else {
      const trimmed = answer.trim();
      if (!trimmed && !question.optional) {
        throw new Error("answer is required");
      }
      question.answer = trimmed;
      question.selectedAnswers = undefined;
    }

    question.extras = extras?.trim() || undefined;
    question.status = "answered";
    question.answeredAt = new Date().toISOString();
    session.updatedAt = new Date().toISOString();
    await this.persist();
    return { session, question };
  }

  /** Mark timed-out questions and hard-delete sessions older than 1 hour. */
  sweep(): void {
    const now = Date.now();
    const retentionCutoff = now - SESSION_RETENTION_SECONDS * 1000;
    let changed = false;

    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((session) => {
      const created = Date.parse(session.createdAt);
      if (!Number.isFinite(created) || created <= retentionCutoff) {
        return false;
      }
      return true;
    });
    if (this.data.sessions.length !== before) {
      changed = true;
    }

    for (const session of this.data.sessions) {
      for (const question of session.questions) {
        if (
          question.status === "pending" &&
          Date.parse(question.expiresAt) <= now
        ) {
          question.status = "timeout";
          changed = true;
        }
      }
    }
    if (changed) {
      void this.persist();
    }
  }

  private persist(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      const tmp = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(this.data, null, 2), "utf8");
      await rename(tmp, this.filePath);
    });
    return this.writeChain;
  }
}
