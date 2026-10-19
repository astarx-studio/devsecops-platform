import { useState } from "react";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import { useTranslation } from "react-i18next";
import { useEnvironment } from "../../shared/keycloak-ui-shared";
import { deleteVerifiableCredential } from "../api/methods";
import type { UserVerifiableCredentialRepresentation } from "../api/representations";
import { FORMAT_DATE_ONLY, formatDate } from "../utils/formatDate";
import { useAccountAlerts } from "../utils/useAccountAlerts";
import { IssuedCredentialsModal } from "./IssuedCredentialsModal";
import { UserAttributesDialog } from "./UserAttributesDialog";

export const CredentialRow = ({
    credential,
    refresh
}: {
    credential: UserVerifiableCredentialRepresentation;
    refresh: () => void;
}) => {
    const { t } = useTranslation();
    const context = useEnvironment();
    const { addAlert, addError } = useAccountAlerts();
    const [showIssued, setShowIssued] = useState(false);
    const [showRevoke, setShowRevoke] = useState(false);
    const hasAttributes = credential.userAttributes != null && Object.keys(credential.userAttributes).length > 0;
    const [showAttributes, setShowAttributes] = useState(false);
    const roles = context.keycloak.tokenParsed?.resource_access?.["account"]?.roles || [];
    const canManage = roles.includes("manage-account") || roles.includes("manage-verifiable-credentials");

    const handleDelete = async () => {
        try {
            await deleteVerifiableCredential(context, credential.credentialScopeName!);
            addAlert(t("credentialDeletedSuccess"));
            refresh();
        } catch (error) {
            addError("credentialDeleteError", error);
        }
    };

    const handleIssue = async () => {
        try {
            const encoded = btoa(JSON.stringify({ credentialConfigurationId: credential.credentialConfigurationId, preAuthorized: false }));
            await context.keycloak.login({ action: `verifiable_credential_offer:${encoded}` });
        } catch (error) {
            addError("credentialIssuanceError", error);
        }
    };

    return (
        <TableRow>
            <TableCell>{credential.credentialScopeName}</TableCell>
            <TableCell>{credential.createdDate ? formatDate(new Date(credential.createdDate), undefined, FORMAT_DATE_ONLY) : "—"}</TableCell>
            <TableCell>{credential.updatedDate ? formatDate(new Date(credential.updatedDate), undefined, FORMAT_DATE_ONLY) : "—"}</TableCell>
            <TableCell>
                <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                    <Button onClick={() => setShowIssued(true)}>{t("viewIssuedCredentials")}</Button>
                    <Button onClick={handleIssue}>{t("issueToWallet")}</Button>
                    {hasAttributes && <Button onClick={() => setShowAttributes(true)}>{t("credentialUserAttributes")}</Button>}
                    {canManage && (
                        <Button color="error" onClick={() => setShowRevoke(true)}>
                            {t("doRevoke")}
                        </Button>
                    )}
                </Stack>
                <Dialog open={showRevoke} onClose={() => setShowRevoke(false)}>
                    <DialogTitle>{t("revokeVerifiableCredentialTitle")}</DialogTitle>
                    <DialogContent>
                        <DialogContentText>{t("deleteCredentialConfirm", { credentialName: credential.credentialScopeName })}</DialogContentText>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setShowRevoke(false)}>{t("doCancel")}</Button>
                        <Button
                            color="error"
                            variant="contained"
                            onClick={async () => {
                                await handleDelete();
                                setShowRevoke(false);
                            }}
                        >
                            {t("doRevoke")}
                        </Button>
                    </DialogActions>
                </Dialog>
                {showAttributes && hasAttributes && (
                    <UserAttributesDialog
                        credentialScopeName={credential.credentialScopeName!}
                        userAttributes={credential.userAttributes!}
                        onClose={() => setShowAttributes(false)}
                    />
                )}
                {showIssued && (
                    <IssuedCredentialsModal
                        credentialScopeName={credential.credentialScopeName!}
                        parentRevision={credential.revision}
                        onClose={() => setShowIssued(false)}
                    />
                )}
            </TableCell>
        </TableRow>
    );
};
