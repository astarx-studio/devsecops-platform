import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import type { AlertEntry } from "./Alerts";

export type AlertPanelProps = {
    alerts: AlertEntry[];
    onCloseAlert: (id: number) => void;
};

const severityFor = (variant: string) => {
    if (variant === "danger") return "error" as const;
    if (variant === "warning") return "warning" as const;
    if (variant === "info") return "info" as const;
    return "success" as const;
};

export function AlertPanel({ alerts, onCloseAlert }: AlertPanelProps) {
    const latest = alerts[0];
    return (
        <Snackbar
            open={!!latest}
            anchorOrigin={{ vertical: "top", horizontal: "right" }}
            data-testid="global-alerts"
        >
            <div>
                {latest && (
                    <Alert
                        data-testid="last-alert"
                        severity={severityFor(String(latest.variant))}
                        onClose={() => onCloseAlert(latest.id)}
                        sx={{ whiteSpace: "pre-wrap", maxWidth: 420 }}
                    >
                        {latest.message}
                        {latest.description ? <div>{latest.description}</div> : null}
                    </Alert>
                )}
            </div>
        </Snackbar>
    );
}
