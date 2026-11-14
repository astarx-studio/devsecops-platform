"use client";

import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import PersonAddAlt1Icon from "@mui/icons-material/PersonAddAlt1";
import PersonOutlinedIcon from "@mui/icons-material/PersonOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import ReplayIcon from "@mui/icons-material/Replay";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  DataGrid,
  GridToolbarColumnsButton,
  GridToolbarContainer,
  GridToolbarDensitySelector,
  GridToolbarFilterButton,
  GridToolbarQuickFilter,
} from "@mui/x-data-grid";
import type { GridColDef } from "@mui/x-data-grid";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { graphqlRequest } from "@/lib/client";
import { MUTATIONS, QUERIES } from "@/lib/graphql";
import type { CompanyOnboarding } from "@/lib/types";

function usernameFromInput(
  raw: string,
  domain: string | null,
): { username: string; mismatch: boolean } {
  const trimmed = raw.trim().toLowerCase().replace(/\s/g, "");
  const at = trimmed.indexOf("@");
  if (at === -1) return { username: trimmed, mismatch: false };
  const pastedDomain = trimmed.slice(at + 1);
  return {
    username: trimmed.slice(0, at),
    mismatch: pastedDomain.length > 0 && pastedDomain !== domain,
  };
}

function formatUpdated(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function personName(record: CompanyOnboarding) {
  return `${record.firstName} ${record.lastName}`.trim() || record.companyEmail;
}

function initials(record: CompanyOnboarding) {
  return `${record.firstName.slice(0, 1)}${record.lastName.slice(0, 1)}`.toUpperCase() || "P";
}

function canResume(record: CompanyOnboarding) {
  return record.state !== "kc_actions_sent" && record.state !== "offboarded";
}

function statusColor(record: CompanyOnboarding): "success" | "error" | "info" | "default" {
  if (record.state === "failed") return "error";
  if (record.state === "kc_actions_sent") return "success";
  if (record.state === "offboarded") return "default";
  return "info";
}

function PeopleToolbar({ onRefresh, loading }: { onRefresh: () => void; loading: boolean }) {
  return (
    <GridToolbarContainer
      sx={{
        px: 1.5,
        py: 1.25,
        gap: 1,
        flexWrap: "wrap",
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <GridToolbarQuickFilter
        debounceMs={300}
        size="small"
        placeholder="Search people, email, or status"
        sx={{
          width: { xs: "100%", sm: 300 },
          "& .MuiInputBase-root": { minHeight: 40 },
        }}
      />
      <Box sx={{ flex: 1 }} />
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
        <GridToolbarColumnsButton />
        <GridToolbarFilterButton />
        <GridToolbarDensitySelector />
        <Button size="small" startIcon={<RefreshIcon />} onClick={onRefresh} disabled={loading}>
          Refresh
        </Button>
      </Stack>
    </GridToolbarContainer>
  );
}

function EmptyPeopleOverlay() {
  return (
    <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ height: "100%", py: 5, px: 3, textAlign: "center" }}>
      <PersonOutlinedIcon sx={{ fontSize: 36, color: "text.disabled" }} />
      <Typography variant="body2" fontWeight={500}>No onboarding records found</Typography>
      <Typography variant="caption" color="text.secondary">
        Adjust the current filters or add a person to begin onboarding.
      </Typography>
    </Stack>
  );
}

function DetailItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
      <Typography
        variant="body2"
        sx={{ mt: 0.25, wordBreak: "break-word", fontFamily: mono ? '"IBM Plex Mono", monospace' : undefined }}
      >
        {value}
      </Typography>
    </Box>
  );
}

export function PeopleOnboardingPanel() {
  const [personalEmail, setPersonalEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [domain, setDomain] = useState<string | null>(null);
  const [domainReady, setDomainReady] = useState(false);
  const [domainMismatch, setDomainMismatch] = useState(false);
  const [rows, setRows] = useState<CompanyOnboarding[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CompanyOnboarding | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offboardTarget, setOffboardTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    try {
      const data = await graphqlRequest<{ companyOnboardings: CompanyOnboarding[] }>(
        QUERIES.companyOnboardings,
        { limit: 100, query: null },
      );
      setRows(data.companyOnboardings);
    } catch (err) {
      setPageError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void fetch("/api/platform-links")
      .then((response) => response.json())
      .then((data: { companyEmailDomain?: string | null }) => {
        setDomain(data.companyEmailDomain?.trim().toLowerCase() || null);
      })
      .catch(() => setDomain(null))
      .finally(() => setDomainReady(true));
  }, []);

  const apply = useCallback((record: CompanyOnboarding) => {
    setRows((current) => [
      record,
      ...current.filter((row) => row.companyEmail !== record.companyEmail),
    ]);
    setSelected((current) => current?.companyEmail === record.companyEmail ? record : current);
  }, []);

  const openAdd = useCallback(() => {
    setPersonalEmail("");
    setFirstName("");
    setLastName("");
    setUsername("");
    setDomainMismatch(false);
    setSubmitted(false);
    setFormError(null);
    setAddOpen(true);
  }, []);

  const closeAdd = useCallback(() => {
    if (!busy) setAddOpen(false);
  }, [busy]);

  const validPersonalEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail.trim());
  const formValid = Boolean(
    domain &&
    validPersonalEmail &&
    firstName.trim() &&
    lastName.trim() &&
    username.trim() &&
    !domainMismatch,
  );

  const start = useCallback(() => {
    setSubmitted(true);
    if (!domain || !formValid) {
      setFormError("Complete all required fields with valid values before starting onboarding.");
      return;
    }
    setBusy(true);
    setFormError(null);
    void (async () => {
      try {
        const data = await graphqlRequest<{ startCompanyOnboarding: CompanyOnboarding }>(
          MUTATIONS.startCompanyOnboarding,
          {
            input: {
              personalEmail: personalEmail.trim(),
              firstName: firstName.trim(),
              lastName: lastName.trim(),
              companyEmail: `${username.trim().toLowerCase()}@${domain}`,
            },
          },
        );
        apply(data.startCompanyOnboarding);
        setAddOpen(false);
        setNotice(`Onboarding started for ${data.startCompanyOnboarding.companyEmail}.`);
      } catch (err) {
        setFormError((err as Error).message);
      } finally {
        setBusy(false);
      }
    })();
  }, [apply, domain, firstName, formValid, lastName, personalEmail, username]);

  const resume = useCallback(
    (email: string) => {
      setBusy(true);
      setPageError(null);
      void (async () => {
        try {
          const data = await graphqlRequest<{ resumeCompanyOnboarding: CompanyOnboarding }>(
            MUTATIONS.resumeCompanyOnboarding,
            { companyEmail: email },
          );
          apply(data.resumeCompanyOnboarding);
          setNotice(`Onboarding resumed for ${email}.`);
        } catch (err) {
          setPageError((err as Error).message);
        } finally {
          setBusy(false);
        }
      })();
    },
    [apply],
  );

  const offboard = useCallback(() => {
    if (!offboardTarget) return;
    const email = offboardTarget;
    setBusy(true);
    setPageError(null);
    void (async () => {
      try {
        const data = await graphqlRequest<{ offboardCompanyEmail: CompanyOnboarding }>(
          MUTATIONS.offboardCompanyEmail,
          { companyEmail: email },
        );
        apply(data.offboardCompanyEmail);
        setOffboardTarget(null);
        setNotice(`Company access removed for ${email}.`);
      } catch (err) {
        setPageError((err as Error).message);
      } finally {
        setBusy(false);
      }
    })();
  }, [apply, offboardTarget]);

  const columns = useMemo<GridColDef<CompanyOnboarding>[]>(() => [
    {
      field: "name",
      headerName: "Person",
      flex: 1,
      minWidth: 180,
      valueGetter: (_value, row) => personName(row),
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
          <Avatar sx={{ width: 32, height: 32, fontSize: 12, bgcolor: "primary.light", color: "primary.dark" }}>
            {initials(row)}
          </Avatar>
          <Typography variant="body2" fontWeight={500} noWrap>{personName(row)}</Typography>
        </Stack>
      ),
    },
    { field: "companyEmail", headerName: "Company email", flex: 1.1, minWidth: 210 },
    { field: "personalEmail", headerName: "Personal inbox", flex: 1.1, minWidth: 210 },
    {
      field: "statusLabel",
      headerName: "Status",
      flex: 0.9,
      minWidth: 180,
      renderCell: ({ row }) => (
        <Chip
          size="small"
          color={statusColor(row)}
          variant="outlined"
          label={row.statusLabel}
          title={row.lastError || row.statusLabel}
          sx={{ maxWidth: "100%", "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis" } }}
        />
      ),
    },
    { field: "mailgunLogin", headerName: "Send login", flex: 1, minWidth: 200, valueGetter: (value) => value || "Not provisioned" },
    {
      field: "updatedAt",
      headerName: "Last updated",
      minWidth: 170,
      sortComparator: (a, b) => Date.parse(String(a)) - Date.parse(String(b)),
      renderCell: ({ value }) => <Typography variant="body2">{formatUpdated(String(value))}</Typography>,
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 150,
      sortable: false,
      filterable: false,
      disableColumnMenu: true,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.25} alignItems="center">
          <Tooltip disableInteractive title="View details">
            <IconButton size="small" aria-label={`View details for ${row.companyEmail}`} onClick={() => setSelected(row)}>
              <VisibilityOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {canResume(row) && (
            <Tooltip disableInteractive title="Resume onboarding">
              <span>
                <IconButton size="small" aria-label={`Resume onboarding for ${row.companyEmail}`} disabled={busy} onClick={() => resume(row.companyEmail)}>
                  <ReplayIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
          {row.state !== "offboarded" && (
            <Tooltip disableInteractive title="Remove company email">
              <span>
                <IconButton size="small" color="error" aria-label={`Remove company email for ${row.companyEmail}`} disabled={busy} onClick={() => setOffboardTarget(row.companyEmail)}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Stack>
      ),
    },
  ], [busy, resume]);

  const toolbar = useCallback(() => <PeopleToolbar onRefresh={() => void load()} loading={loading} />, [load, loading]);
  const personalEmailHelper = submitted && !personalEmail.trim()
    ? "Personal email is required."
    : submitted && !validPersonalEmail
      ? "Enter a valid email address."
      : "Company mail and setup instructions are delivered here.";

  return (
    <Stack spacing={2} maxWidth="none">
      {pageError && (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void load()}>Retry</Button>}>
          {pageError}
        </Alert>
      )}
      {domainReady && !domain && (
        <Alert severity="warning">
          Company email onboarding is unavailable because the company domain is not configured.
        </Alert>
      )}

      <Paper variant="outlined" sx={{ overflow: "hidden", width: "100%" }} aria-busy={busy}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          alignItems={{ sm: "center" }}
          justifyContent="space-between"
          sx={{ px: { xs: 2, md: 2.5 }, py: 2 }}
        >
          <Box>
            <Typography variant="h6" component="h2">Onboarding directory</Typography>
            <Typography variant="body2" color="text.secondary">
              {rows.length} {rows.length === 1 ? "record" : "records"} · Filter, sort, or open a record to manage its progress.
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<PersonAddAlt1Icon />}
            onClick={openAdd}
            disabled={domainReady && !domain}
          >
            Add person
          </Button>
        </Stack>
        <Divider />
        <DataGrid
          rows={rows}
          columns={columns}
          getRowId={(row) => row.companyEmail}
          loading={loading}
          autoHeight
          rowHeight={58}
          columnHeaderHeight={48}
          disableRowSelectionOnClick
          pageSizeOptions={[10, 25, 50]}
          initialState={{
            pagination: { paginationModel: { pageSize: 10 } },
            sorting: { sortModel: [{ field: "updatedAt", sort: "desc" }] },
          }}
          slots={{ toolbar, noRowsOverlay: EmptyPeopleOverlay, noResultsOverlay: EmptyPeopleOverlay }}
          aria-label="Company onboarding records"
          sx={{
            border: 0,
            minWidth: 0,
            "& .MuiDataGrid-columnHeaders": { bgcolor: "#f2f5f6" },
            "& .MuiDataGrid-columnHeaderTitle": { color: "text.secondary", fontSize: 12, fontWeight: 600 },
            "& .MuiDataGrid-cell": { borderBottomColor: "divider" },
            "& .MuiDataGrid-row:hover": { bgcolor: "rgba(15,107,99,0.025)" },
            "& .MuiDataGrid-cell:focus, & .MuiDataGrid-columnHeader:focus": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
            "& .MuiDataGrid-cell:focus-within, & .MuiDataGrid-columnHeader:focus-within": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
            "& .MuiDataGrid-footerContainer": { borderTopColor: "divider" },
          }}
        />
      </Paper>

      <Dialog
        open={addOpen}
        onClose={busy ? undefined : closeAdd}
        maxWidth="sm"
        fullWidth
        aria-labelledby="add-person-title"
        aria-describedby="add-person-description"
      >
        <Box
          component="form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            start();
          }}
        >
          <DialogTitle id="add-person-title" sx={{ pr: 6 }}>
            Add person
            <IconButton aria-label="Close add person dialog" onClick={closeAdd} disabled={busy} sx={{ position: "absolute", right: 12, top: 10 }}>
              <CloseIcon />
            </IconButton>
          </DialogTitle>
          <DialogContent dividers>
            <Typography id="add-person-description" variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
              Create a company email forward, Mailgun send login, and DSOaaS account. The person sets their own password from the invitation email.
            </Typography>
            {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
            <Stack spacing={2.25}>
              <TextField
                label="Personal email"
                type="email"
                value={personalEmail}
                onChange={(event) => setPersonalEmail(event.target.value)}
                helperText={personalEmailHelper}
                error={submitted && (!personalEmail.trim() || !validPersonalEmail)}
                autoComplete="email"
                fullWidth
                required
                autoFocus
                disabled={busy}
              />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  label="First name"
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  helperText={submitted && !firstName.trim() ? "First name is required." : " "}
                  error={submitted && !firstName.trim()}
                  autoComplete="given-name"
                  fullWidth
                  required
                  disabled={busy}
                />
                <TextField
                  label="Last name"
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  helperText={submitted && !lastName.trim() ? "Last name is required." : " "}
                  error={submitted && !lastName.trim()}
                  autoComplete="family-name"
                  fullWidth
                  required
                  disabled={busy}
                />
              </Stack>
              <TextField
                label="Company username"
                value={username}
                onChange={(event) => {
                  const parsed = usernameFromInput(event.target.value, domain);
                  setUsername(parsed.username);
                  setDomainMismatch(parsed.mismatch);
                }}
                helperText={
                  domainMismatch
                    ? `Use a username on @${domain}.`
                    : !domainReady
                      ? "Loading the company domain…"
                      : domain
                        ? submitted && !username.trim()
                          ? "Company username is required."
                          : "The sign-in address combines this username with the company domain."
                        : "Company domain is not configured."
                }
                error={domainMismatch || (submitted && !username.trim()) || (domainReady && !domain)}
                slotProps={{
                  input: {
                    endAdornment: domain ? <InputAdornment position="end">@{domain}</InputAdornment> : undefined,
                  },
                }}
                autoComplete="username"
                fullWidth
                required
                disabled={!domain || busy}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button onClick={closeAdd} disabled={busy}>Cancel</Button>
            <Button type="submit" variant="contained" startIcon={<AddOutlinedIcon />} disabled={busy || !domainReady || !domain}>
              {busy ? "Starting onboarding…" : "Start onboarding"}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog
        open={Boolean(selected)}
        onClose={busy ? undefined : () => setSelected(null)}
        maxWidth="sm"
        fullWidth
        aria-labelledby="person-details-title"
      >
        {selected && (
          <>
            <DialogTitle id="person-details-title" sx={{ pr: 6 }}>
              {personName(selected)}
              <IconButton aria-label="Close person details" onClick={() => setSelected(null)} disabled={busy} sx={{ position: "absolute", right: 12, top: 10 }}>
                <CloseIcon />
              </IconButton>
            </DialogTitle>
            <DialogContent dividers>
              <Stack spacing={2}>
                <Alert severity={selected.state === "failed" ? "error" : selected.state === "kc_actions_sent" ? "success" : "info"}>
                  {selected.statusLabel}{selected.lastError ? ` ${selected.lastError}` : ""}
                </Alert>
                {(selected.state === "awaiting_destination" || selected.state === "failed") && (
                  <Typography variant="body2" color="text.secondary">
                    Confirm both addresses before continuing. Resume checks Cloudflare again and, once the personal inbox is verified, sends the setup mail and DSOaaS invitation.
                  </Typography>
                )}
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" }, gap: 2 }}>
                  <DetailItem label="Company email" value={selected.companyEmail} />
                  <DetailItem label="Personal inbox" value={selected.personalEmail} />
                  <DetailItem label="Send login" value={selected.mailgunLogin || "Not provisioned"} />
                  <DetailItem label="Workflow state" value={selected.state.replaceAll("_", " ")} />
                  <DetailItem label="Last updated" value={formatUpdated(selected.updatedAt)} />
                  <DetailItem label="Keycloak user ID" value={selected.keycloakUserId || "Not provisioned"} mono />
                </Box>
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2, flexWrap: "wrap", gap: 1 }}>
              <Button onClick={() => setSelected(null)} disabled={busy}>Close</Button>
              <Box sx={{ flex: 1 }} />
              {canResume(selected) && (
                <Button variant="outlined" startIcon={<ReplayIcon />} disabled={busy} onClick={() => resume(selected.companyEmail)}>
                  Resume onboarding
                </Button>
              )}
              {selected.state !== "offboarded" && (
                <Button color="error" startIcon={<DeleteOutlineIcon />} disabled={busy} onClick={() => setOffboardTarget(selected.companyEmail)}>
                  Remove company email
                </Button>
              )}
            </DialogActions>
          </>
        )}
      </Dialog>

      <ConfirmDialog
        open={Boolean(offboardTarget)}
        title="Remove company email"
        message="This disables the DSOaaS account, deletes the forward, and deletes the Mailgun send login. Mail already delivered stays in the personal inbox."
        confirmLabel="Remove company email"
        typedMatch={offboardTarget ?? undefined}
        busy={busy}
        onClose={() => setOffboardTarget(null)}
        onConfirm={offboard}
      />

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={4500}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        <Alert severity="success" variant="filled" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      </Snackbar>
    </Stack>
  );
}
