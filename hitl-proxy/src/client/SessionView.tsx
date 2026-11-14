import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormLabel,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getSession, submitAnswer, type Question, type Session } from "./api";

interface Props {
  sessionId: string;
  onChanged: () => void;
}

interface Draft {
  answer: string;
  selected: string[];
  extras: string;
}

function emptyDraft(): Draft {
  return { answer: "", selected: [], extras: "" };
}

/** Bordered hit-target for each predefined answer (a11y / easier to scan). */
function answerOptionSx(selected: boolean) {
  return {
    m: 0,
    width: "100%",
    // Keep control at top so multi-line labels don't float the radio mid-block;
    // then pad the label so the *first line* centers with the radio/checkbox glyph.
    alignItems: "flex-start",
    px: 1.5,
    py: 1,
    border: 2,
    borderColor: selected ? "primary.main" : "divider",
    borderRadius: 1,
    bgcolor: selected ? "action.selected" : "background.paper",
    transition: "border-color 120ms ease, background-color 120ms ease",
    "&:hover": {
      borderColor: selected ? "primary.dark" : "text.secondary",
      bgcolor: selected ? "action.selected" : "action.hover",
    },
    "& .MuiRadio-root, & .MuiCheckbox-root": {
      // Keep glyph top-aligned with the label box; first-line center is
      // matched via label paddingTop (not a negative margin on the control).
      padding: "5px",
    },
    "& .MuiFormControlLabel-label": {
      // small icon 20px → center at pad+10; body1 line 24px → center at 12.
      // padTop 3 ≈ first-line vertical center with the radio/checkbox glyph.
      paddingTop: "3px",
      lineHeight: 1.5,
    },
  } as const;
}

function draftFromQuestion(question: Question): Draft {
  const multi = question.allowMultiple === true;
  const selected = question.selectedAnswers?.length
    ? [...question.selectedAnswers]
    : multi && question.answer
      ? question.answer
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
      : question.answer
        ? [question.answer]
        : [];
  return {
    selected: multi ? selected : selected.slice(0, 1),
    answer: question.answer ?? (selected.length ? selected.join(", ") : ""),
    extras: question.extras ?? "",
  };
}

function draftIsFilled(
  draft: Draft,
  multi: boolean,
  optional = false,
): boolean {
  if (optional) return true;
  if (multi) {
    return draft.selected.length > 0 || draft.answer.trim().length > 0;
  }
  return draft.answer.trim().length > 0;
}

export function SessionView({ sessionId, onChanged }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [step, setStep] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await getSession(sessionId);
      setSession(data.session);
      setError(null);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const q of data.session.questions ?? []) {
          if (!next[q.id] && (q.answer || q.status === "answered")) {
            next[q.id] = draftFromQuestion(q);
          }
          if (!next[q.id]) {
            next[q.id] = emptyDraft();
          }
        }
        return next;
      });
      const hasOpen = (data.session.questions ?? []).some(
        (q) => q.status === "pending" || q.status === "timeout",
      );
      const done = (data.session.questions ?? []).every(
        (q) => q.status === "answered",
      );
      if (done) {
        setWizardOpen(false);
      } else if (hasOpen) {
        setWizardOpen(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load session");
      setSession(null);
    }
  }, [sessionId]);

  useEffect(() => {
    setStep(0);
    setDrafts({});
    setWizardOpen(true);
    void load();
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = setInterval(() => void load(), 2500);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const sessionUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/s/${sessionId}`;
  }, [sessionId]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(sessionUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Could not copy link");
    }
  };

  const questions = session?.questions ?? [];
  const total = questions.length;
  const current = questions[step];
  const isLast = total > 0 && step === total - 1;
  const pendingCount = questions.filter((q) => q.status === "pending").length;
  const allAnswered =
    total > 0 && questions.every((q) => q.status === "answered");

  const updateDraft = (questionId: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({
      ...prev,
      [questionId]: { ...(prev[questionId] ?? emptyDraft()), ...patch },
    }));
  };

  const currentDraft = current
    ? (drafts[current.id] ?? emptyDraft())
    : emptyDraft();
  const currentMulti = current?.allowMultiple === true;

  const goNext = () => {
    if (!current) return;
    if (!draftIsFilled(currentDraft, currentMulti, current.optional === true)) {
      setError("Pick or type an answer before continuing");
      return;
    }
    setError(null);
    setStep((s) => Math.min(s + 1, total - 1));
  };

  const goBack = () => {
    setError(null);
    setStep((s) => Math.max(s - 1, 0));
  };

  const submitAll = async () => {
    if (!current || !session) return;
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const draft = drafts[q.id] ?? emptyDraft();
      if (
        !draftIsFilled(draft, q.allowMultiple === true, q.optional === true)
      ) {
        setError(`Question ${i + 1} still needs an answer`);
        setStep(i);
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      for (const q of questions) {
        const draft = drafts[q.id] ?? emptyDraft();
        const multi = q.allowMultiple === true;
        const selectedAnswers = multi
          ? draft.selected.length > 0
            ? draft.selected
            : draft.answer
                .split(",")
                .map((part) => part.trim())
                .filter(Boolean)
          : undefined;
        await submitAnswer(sessionId, {
          questionId: q.id,
          answer: multi ? (selectedAnswers ?? []).join(", ") : draft.answer,
          selectedAnswers: multi ? selectedAnswers : undefined,
          extras: draft.extras.trim() || undefined,
        });
      }
      setWizardOpen(false);
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit answers");
    } finally {
      setBusy(false);
    }
  };

  if (!session) {
    return (
      <Typography color="text.secondary">
        {error ?? "Loading session…"}
      </Typography>
    );
  }

  return (
    <Stack spacing={2.5} sx={{ pb: 6 }}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Paper sx={{ p: 2.5 }} variant="outlined">
        <Stack spacing={1.5}>
          <Typography variant="h6" fontWeight={700}>
            {session.title}
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              color="primary"
              label={`${total} question${total === 1 ? "" : "s"} in this session`}
            />
            <Chip
              size="small"
              color={pendingCount > 0 ? "warning" : "success"}
              label={pendingCount > 0 ? `${pendingCount} pending` : "all done"}
            />
            {wizardOpen && total > 1 && (
              <Chip
                size="small"
                label={`Step ${step + 1} of ${total}`}
                variant="outlined"
              />
            )}
          </Stack>
          {wizardOpen && total > 1 && (
            <Alert severity="info" sx={{ py: 0.5 }}>
              Use <strong>Next</strong> through questions 1–
              {Math.max(total - 1, 1)}. Only the last step has{" "}
              <strong>Submit</strong> (saves every answer together). You can go
              Back and change drafts anytime before Submit — after Submit,
              answers are locked.
            </Alert>
          )}
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            alignItems={{ sm: "center" }}
          >
            <TextField
              label="Session link"
              value={sessionUrl}
              fullWidth
              size="small"
              slotProps={{ htmlInput: { readOnly: true } }}
            />
            <Button
              startIcon={<ContentCopyIcon />}
              onClick={() => void copyLink()}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {total === 0 && (
        <Alert severity="warning">This session has no questions.</Alert>
      )}

      {!wizardOpen && allAnswered && (
        <Stack spacing={2}>
          {questions.map((q, index) => (
            <Paper key={q.id} sx={{ p: 3 }}>
              <Stack spacing={1}>
                <Chip
                  size="small"
                  label={`Question ${index + 1} of ${total}`}
                  variant="outlined"
                />
                <Typography variant="h6" fontWeight={700}>
                  {q.content}
                </Typography>
                <Typography
                  variant="body1"
                  whiteSpace="pre-wrap"
                  color={!q.answer && q.optional ? "text.secondary" : undefined}
                >
                  {q.selectedAnswers?.length
                    ? q.selectedAnswers.join(", ")
                    : q.answer || (q.optional ? "(nothing else)" : "")}
                </Typography>
                {q.extras && (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    whiteSpace="pre-wrap"
                  >
                    {q.extras}
                  </Typography>
                )}
              </Stack>
            </Paper>
          ))}
          <Typography variant="body2" color="text.secondary">
            Answers are locked and cannot be changed.
          </Typography>
        </Stack>
      )}

      {wizardOpen && current && (
        <QuestionStep
          question={current}
          index={step}
          total={total}
          now={now}
          draft={currentDraft}
          busy={busy}
          onDraftChange={(patch) => updateDraft(current.id, patch)}
          onBack={step > 0 ? goBack : undefined}
          onNext={!isLast ? goNext : undefined}
          onSubmit={isLast ? () => void submitAll() : undefined}
        />
      )}
    </Stack>
  );
}

function QuestionStep({
  question,
  index,
  total,
  now,
  draft,
  busy,
  onDraftChange,
  onBack,
  onNext,
  onSubmit,
}: {
  question: Question;
  index: number;
  total: number;
  now: number;
  draft: Draft;
  busy: boolean;
  onDraftChange: (patch: Partial<Draft>) => void;
  onBack?: () => void;
  onNext?: () => void;
  onSubmit?: () => void;
}) {
  const multi = question.allowMultiple === true;
  const remainingMs =
    question.status === "pending"
      ? Math.max(0, Date.parse(question.expiresAt) - now)
      : 0;

  const toggleMulti = (value: string) => {
    const selected = draft.selected.includes(value)
      ? draft.selected.filter((item) => item !== value)
      : [...draft.selected, value];
    onDraftChange({ selected, answer: selected.join(", ") });
  };

  const clearSelection = () => {
    onDraftChange({ selected: [], answer: "" });
  };

  const optional = question.optional === true;
  const canContinue = draftIsFilled(draft, multi, optional);

  return (
    <Paper sx={{ p: 3 }} id={`q-${question.id}`}>
      <Stack spacing={2}>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
        >
          <Chip
            size="small"
            label={`Question ${index + 1} of ${total}`}
            color="primary"
            variant="outlined"
          />
          {multi && (
            <Chip
              size="small"
              label="multi-select — pick several"
              color="secondary"
            />
          )}
          {optional && (
            <Chip size="small" label="optional — can skip" color="default" />
          )}
          {question.status === "pending" && (
            <Typography variant="body2" color="text.secondary">
              Expires in {formatRemaining(remainingMs)} · draft until final
              Submit
            </Typography>
          )}
        </Stack>

        <Typography variant="h6" fontWeight={700}>
          {question.content}
        </Typography>

        {question.predefinedAnswers.length > 0 && multi && (
          <FormControl component="fieldset" variant="standard">
            <FormLabel component="legend">
              Select all that apply — change freely before{" "}
              {total > 1 && !onSubmit ? "Next" : "Submit"}
            </FormLabel>
            <FormGroup sx={{ gap: 1, mt: 1 }}>
              {question.predefinedAnswers.map((option) => {
                const selected = draft.selected.includes(option);
                return (
                  <FormControlLabel
                    key={option}
                    control={
                      <Checkbox
                        size="small"
                        checked={selected}
                        onChange={() => toggleMulti(option)}
                      />
                    }
                    label={option}
                    sx={answerOptionSx(selected)}
                  />
                );
              })}
            </FormGroup>
            <Button
              size="small"
              onClick={clearSelection}
              sx={{ alignSelf: "flex-start", mt: 0.5 }}
            >
              Clear selection
            </Button>
          </FormControl>
        )}

        {question.predefinedAnswers.length > 0 && !multi && (
          <FormControl>
            <FormLabel>
              Choose one — switch anytime before{" "}
              {total > 1 && !onSubmit ? "Next" : "Submit"}
            </FormLabel>
            <RadioGroup
              value={draft.answer}
              onChange={(event) => {
                onDraftChange({
                  answer: event.target.value,
                  selected: [event.target.value],
                });
              }}
              sx={{ gap: 1, mt: 1 }}
            >
              {question.predefinedAnswers.map((option) => {
                const selected = draft.answer === option;
                return (
                  <FormControlLabel
                    key={option}
                    value={option}
                    control={<Radio size="small" />}
                    label={option}
                    sx={answerOptionSx(selected)}
                  />
                );
              })}
            </RadioGroup>
            <Button
              size="small"
              onClick={clearSelection}
              sx={{ alignSelf: "flex-start", mt: 0.5 }}
            >
              Clear selection
            </Button>
          </FormControl>
        )}

        <TextField
          label={
            optional
              ? "Anything else (optional)"
              : multi
                ? "Selected (or type free-form)"
                : "Answer"
          }
          value={draft.answer}
          onChange={(e) => {
            onDraftChange({
              answer: e.target.value,
              selected: multi ? draft.selected : [],
            });
          }}
          fullWidth
          multiline
          minRows={optional ? 3 : 2}
          helperText={
            optional ? "Leave blank if nothing else to add" : undefined
          }
        />
        {!optional && (
          <TextField
            label="Notes for the agent (optional)"
            value={draft.extras}
            onChange={(e) => onDraftChange({ extras: e.target.value })}
            fullWidth
            multiline
            minRows={1}
            size="small"
          />
        )}

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {onBack && (
            <Button variant="outlined" disabled={busy} onClick={onBack}>
              Back
            </Button>
          )}
          {onNext && (
            <Button
              variant="contained"
              disabled={busy || !canContinue}
              onClick={onNext}
            >
              Next
            </Button>
          )}
          {onSubmit && (
            <Button
              variant="contained"
              disabled={busy || !canContinue}
              onClick={onSubmit}
            >
              {total > 1 ? "Submit all answers" : "Submit answer"}
            </Button>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}

function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
