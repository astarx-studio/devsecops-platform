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
  onConfirm: (forceGitLabDelete: boolean) => void;
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

  useEffect(() => {
    if (open) {
      setForceGitLab(archived);
    }
  }, [open, archived]);

  const handleClose = () => {
    if (!busy) {
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{archived ? 'Force delete GitLab project' : 'Unregister project'}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          {archived ? (
            <>
              Retry permanent deletion of <strong>{gitlabPath}</strong> on GitLab. Platform
              resources were already torn down when this project was archived.
            </>
          ) : (
            <>
              Unregister <strong>{gitlabPath}</strong> from the platform? K8s targets, Vault, and
              Sonar resources will be removed. If GitLab still has container images, deletion may
              fail and the project will appear under <strong>Archived</strong>.
            </>
          )}
        </DialogContentText>
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
          onClick={() => onConfirm(forceGitLab)}
          disabled={busy}
        >
          {archived ? 'Force delete' : 'Delete'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
