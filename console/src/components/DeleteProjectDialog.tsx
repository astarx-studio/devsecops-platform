'use client';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
} from '@mui/material';
import { useEffect, useState } from 'react';

interface Props {
  open: boolean;
  archived: boolean;
  gitlabPath: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (forceGitLabDelete: boolean, skipPlatformCleanup: boolean) => void;
}

export function DeleteProjectDialog({
  open,
  archived,
  gitlabPath,
  busy,
  onClose,
  onConfirm,
}: Props) {
  const [forceGitLab, setForceGitLab] = useState(archived);
  const [retryPlatform, setRetryPlatform] = useState(true);

  useEffect(() => {
    if (open) {
      setForceGitLab(archived);
      setRetryPlatform(true);
    }
  }, [open, archived]);

  const handleClose = () => {
    if (!busy) {
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{archived ? 'Retry unregister' : 'Unregister project'}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          {archived ? (
            <>
              <strong>{gitlabPath}</strong> is archived because something was still left behind
              (GitLab, Kubernetes, Vault, or Sonar). Archive does <strong>not</strong> mean
              teardown finished. Retry platform cleanup unless you only want another GitLab delete
              attempt.
            </>
          ) : (
            <>
              Unregister <strong>{gitlabPath}</strong>? The API will try to remove K8s releases,
              the Vault tree, and Sonar projects, then delete the GitLab project. If anything
              remains, the row is archived — that is not a successful teardown.
            </>
          )}
        </DialogContentText>
        {archived && (
          <FormControlLabel
            control={
              <Checkbox
                checked={retryPlatform}
                onChange={(e) => setRetryPlatform(e.target.checked)}
                disabled={busy}
              />
            }
            label="Retry platform cleanup (Kubernetes, Vault, Sonar)"
          />
        )}
        <FormControlLabel
          control={
            <Checkbox
              checked={forceGitLab}
              onChange={(e) => setForceGitLab(e.target.checked)}
              disabled={busy}
            />
          }
          label="Force delete on GitLab (purge container registry and packages first)"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          color="error"
          variant="contained"
          onClick={() => onConfirm(forceGitLab, archived ? !retryPlatform : false)}
          disabled={busy}
        >
          {archived ? 'Retry delete' : 'Delete'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
