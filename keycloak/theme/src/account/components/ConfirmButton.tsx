import { useState, type ReactNode } from "react";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";

type ConfirmButtonProps = {
    title: ReactNode;
    message: ReactNode;
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: () => void | Promise<void>;
    disabled?: boolean;
    color?: "primary" | "secondary" | "error" | "inherit";
    variant?: "text" | "outlined" | "contained";
    id?: string;
};

export function ConfirmButton({
    title,
    message,
    confirmLabel,
    cancelLabel,
    onConfirm,
    disabled,
    color = "primary",
    variant = "outlined",
    id
}: ConfirmButtonProps) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);

    return (
        <>
            <Button id={id} variant={variant} color={color} disabled={disabled} onClick={() => setOpen(true)}>
                {title}
            </Button>
            <Dialog open={open} onClose={() => !busy && setOpen(false)}>
                <DialogTitle>{title}</DialogTitle>
                <DialogContent>
                    <DialogContentText>{message}</DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button disabled={busy} onClick={() => setOpen(false)}>
                        {cancelLabel}
                    </Button>
                    <Button
                        variant="contained"
                        color={color === "inherit" ? "primary" : color}
                        disabled={busy}
                        onClick={async () => {
                            setBusy(true);
                            try {
                                await onConfirm();
                                setOpen(false);
                            } finally {
                                setBusy(false);
                            }
                        }}
                    >
                        {confirmLabel}
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}
