import { useEffect, useState } from "react";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Link from "@mui/material/Link";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { label, useEnvironment } from "../../shared/keycloak-ui-shared";
import { getIssuedVerifiableCredentials, revokeIssuedVerifiableCredential } from "../api/methods";
import type { IssuedUserVerifiableCredentialRepresentation } from "../api/representations";
import { useAccountAlerts } from "../utils/useAccountAlerts";

export const IssuedCredentialsModal = ({
    credentialScopeName,
    onClose
}: {
    credentialScopeName: string;
    parentRevision?: string;
    onClose: () => void;
}) => {
    const { t } = useTranslation();
    const context = useEnvironment();
    const { addAlert, addError } = useAccountAlerts();
    const [rows, setRows] = useState<IssuedUserVerifiableCredentialRepresentation[]>([]);
    const [selected, setSelected] = useState<IssuedUserVerifiableCredentialRepresentation>();
    const roles = context.keycloak.tokenParsed?.resource_access?.["account"]?.roles || [];
    const canManage = roles.includes("manage-account") || roles.includes("manage-verifiable-credentials");

    useEffect(() => {
        const controller = new AbortController();
        getIssuedVerifiableCredentials({ signal: controller.signal, context })
            .then(data => setRows(data.filter(item => item.credentialType === credentialScopeName)))
            .catch(() => setRows([]));
        return () => controller.abort();
    }, [context, credentialScopeName, selected]);

    const revoke = async (id: string) => {
        try {
            await revokeIssuedVerifiableCredential(context, id);
            addAlert(t("issuedCredentialRevokeSuccess"));
            setSelected(undefined);
        } catch (error) {
            addError(t("issuedCredentialRevokeError"), error);
        }
    };

    return (
        <Dialog open onClose={onClose} fullWidth maxWidth="md">
            <DialogTitle>
                {t("issuedCredentials")}: {credentialScopeName}
            </DialogTitle>
            <DialogContent>
                {rows.length === 0 ? (
                    <Typography color="text.secondary">{t("noIssuedCredentials")}</Typography>
                ) : (
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>{t("issuedCredentialsIssuedAt")}</TableCell>
                                <TableCell>{t("issuedCredentialsExpiresAt")}</TableCell>
                                <TableCell>{t("issuedCredentialsWalletClient")}</TableCell>
                                {canManage && <TableCell />}
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {rows.map(row => {
                                const expired = row.expiresAt ? new Date(row.expiresAt) < new Date() : false;
                                const name = row.clientName || row.clientId;
                                return (
                                    <TableRow key={row.id}>
                                        <TableCell>{row.issuedAt ? new Date(row.issuedAt).toLocaleString() : "—"}</TableCell>
                                        <TableCell sx={{ color: expired ? "error.main" : "inherit" }}>
                                            {row.expiresAt ? new Date(row.expiresAt).toLocaleString() : "—"}
                                        </TableCell>
                                        <TableCell>
                                            {row.clientBaseUrl && name ? (
                                                <Link href={row.clientBaseUrl} target="_blank" rel="noreferrer">
                                                    {label(t, name)}
                                                </Link>
                                            ) : (
                                                name || "—"
                                            )}
                                        </TableCell>
                                        {canManage && (
                                            <TableCell>
                                                <Button color="error" onClick={() => setSelected(row)}>
                                                    {t("doRevoke")}
                                                </Button>
                                            </TableCell>
                                        )}
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>{t("close")}</Button>
            </DialogActions>
            <Dialog open={!!selected} onClose={() => setSelected(undefined)}>
                <DialogTitle>{t("revokeIssuedCredentialTitle")}</DialogTitle>
                <DialogContent>
                    <DialogContentText>{t("deleteIssuedCredentialConfirm")}</DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setSelected(undefined)}>{t("doCancel")}</Button>
                    <Button color="error" variant="contained" onClick={() => selected?.id && revoke(selected.id)}>
                        {t("doRevoke")}
                    </Button>
                </DialogActions>
            </Dialog>
        </Dialog>
    );
};
