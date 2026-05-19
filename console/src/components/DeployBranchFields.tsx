'use client';
import {
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';

export interface DeployBranchFormState {
  defaultBranch: string;
  useForAllTargets: boolean;
  devRef: string;
  stgRef: string;
  prodRef: string;
}

export const emptyDeployBranchForm = (): DeployBranchFormState => ({
  defaultBranch: '',
  useForAllTargets: false,
  devRef: '',
  stgRef: '',
  prodRef: '',
});

/** Maps form state to GraphQL DeployBranchOptionsInput (omitted when empty). */
export function buildBranchOptionsInput(state: DeployBranchFormState) {
  const defaultBranch = state.defaultBranch.trim() || undefined;
  const deployRefs = {
    dev: state.devRef.trim() || undefined,
    stg: state.stgRef.trim() || undefined,
    prod: state.prodRef.trim() || undefined,
  };
  const hasDeployRefs = !!(deployRefs.dev || deployRefs.stg || deployRefs.prod);

  if (!defaultBranch && !hasDeployRefs && !state.useForAllTargets) {
    return undefined;
  }

  return {
    defaultBranch,
    useDefaultBranchForAllDeployTargets: state.useForAllTargets || undefined,
    deployRefs: hasDeployRefs ? deployRefs : undefined,
  };
}

interface Props {
  showPerEnv: boolean;
  state: DeployBranchFormState;
  onChange: (state: DeployBranchFormState) => void;
  disabled?: boolean;
}

export function DeployBranchFields({ showPerEnv, state, onChange, disabled }: Props) {
  const set = (patch: Partial<DeployBranchFormState>) => onChange({ ...state, ...patch });

  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        Override branches for the first pipeline run and for deploy jobs. Leave everything empty to
        use GitLab&apos;s default branch plus platform defaults (develop → dev, staging → stg, main →
        prod).
      </Typography>
      <TextField
        label="Default branch"
        value={state.defaultBranch}
        onChange={(e) => set({ defaultBranch: e.target.value })}
        placeholder="e.g. master (GitLab default if empty)"
        fullWidth
        disabled={disabled}
        size="small"
      />
      {showPerEnv && (
        <>
          <FormControlLabel
            control={
              <Switch
                checked={state.useForAllTargets}
                onChange={(e) => set({ useForAllTargets: e.target.checked })}
                disabled={disabled || !state.defaultBranch.trim()}
              />
            }
            label="Single-branch repo: use default branch for dev, stg, and prod"
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
            When off, only prod uses the default branch; dev and stg keep develop / staging unless
            you fill the fields below. When on, all three deploy targets use the same branch (typical
            for repos with only master or main).
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              label="Dev branch"
              value={state.devRef}
              onChange={(e) => set({ devRef: e.target.value })}
              placeholder="develop"
              fullWidth
              disabled={disabled}
              size="small"
            />
            <TextField
              label="Stg branch"
              value={state.stgRef}
              onChange={(e) => set({ stgRef: e.target.value })}
              placeholder="staging"
              fullWidth
              disabled={disabled}
              size="small"
            />
            <TextField
              label="Prod branch"
              value={state.prodRef}
              onChange={(e) => set({ prodRef: e.target.value })}
              placeholder="main"
              fullWidth
              disabled={disabled}
              size="small"
            />
          </Stack>
        </>
      )}
    </Stack>
  );
}
