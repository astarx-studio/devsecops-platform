import { useEffect, useState } from "react";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { useEnvironment } from "../../shared/keycloak-ui-shared";
import { getVerifiableCredentials } from "../api/methods";
import type { UserVerifiableCredentialRepresentation } from "../api/representations";
import { Page } from "../components/page/Page";
import { CredentialRow } from "./CredentialRow";

export const VerifiableCredentials = () => {
    const { t } = useTranslation();
    const context = useEnvironment();
    const [credentials, setCredentials] = useState<UserVerifiableCredentialRepresentation[]>([]);
    const [key, setKey] = useState(1);

    useEffect(() => {
        const controller = new AbortController();
        getVerifiableCredentials({ signal: controller.signal, context })
            .then(setCredentials)
            .catch(() => setCredentials([]));
        return () => controller.abort();
    }, [key, context]);

    return (
        <Page title={t("verifiableCredentials")} description={t("verifiableCredentialsDescription")}>
            <Stack spacing={2}>
                <Typography variant="h5" component="h2">
                    {t("myVerifiableCredentials")}
                </Typography>
                {credentials.length === 0 ? (
                    <Typography color="text.secondary">{t("noVerifiableCredentials")}</Typography>
                ) : (
                    <Table size="small" aria-label={t("verifiableCredentials")}>
                        <TableHead>
                            <TableRow>
                                <TableCell>{t("credentialScopeName")}</TableCell>
                                <TableCell>{t("credentialCreatedDate")}</TableCell>
                                <TableCell>{t("credentialUpdatedDate")}</TableCell>
                                <TableCell />
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {credentials.map(credential => (
                                <CredentialRow key={credential.credentialScopeName} credential={credential} refresh={() => setKey(current => current + 1)} />
                            ))}
                        </TableBody>
                    </Table>
                )}
            </Stack>
        </Page>
    );
};

export default VerifiableCredentials;
