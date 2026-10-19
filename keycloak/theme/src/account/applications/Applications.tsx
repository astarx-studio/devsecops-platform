import { useState } from "react";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import CircularProgress from "@mui/material/CircularProgress";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CheckIcon from "@mui/icons-material/Check";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { useTranslation } from "react-i18next";
import { label, useEnvironment } from "../../shared/keycloak-ui-shared";
import type { AccountEnvironment } from "..";
import { deleteConsent, getApplications } from "../api/methods";
import type { ClientRepresentation } from "../api/representations";
import { ConfirmButton } from "../components/ConfirmButton";
import { Page } from "../components/page/Page";
import type { TFuncKey } from "../i18n-type";
import { formatDate } from "../utils/formatDate";
import { useAccountAlerts } from "../utils/useAccountAlerts";
import { usePromise } from "../utils/usePromise";

type Application = ClientRepresentation & { open: boolean };

export const Applications = () => {
    const { t } = useTranslation();
    const context = useEnvironment<AccountEnvironment>();
    const { addAlert, addError } = useAccountAlerts();
    const [applications, setApplications] = useState<Application[]>();
    const [key, setKey] = useState(1);

    usePromise(
        signal => getApplications({ signal, context }),
        clients => setApplications(clients.map(client => ({ ...client, open: false }))),
        [key]
    );

    const removeConsent = async (id: string) => {
        try {
            await deleteConsent(context, id);
            setKey(current => current + 1);
            addAlert(t("removeConsentSuccess"));
        } catch (error) {
            addError("removeConsentError", error);
        }
    };

    if (!applications) {
        return <CircularProgress />;
    }

    return (
        <Page title={t("application")} description={t("applicationsIntroMessage")}>
            <Stack spacing={1}>
                {applications.map(application => {
                    const name = label(t, application.clientName || application.clientId);
                    return (
                        <Accordion key={application.clientId} data-testid="applications-list-item">
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ width: "100%", pr: 2 }}>
                                    <Typography sx={{ flex: 1 }}>
                                        {application.effectiveUrl ? (
                                            <Link
                                                href={application.effectiveUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                onClick={event => event.stopPropagation()}
                                            >
                                                {name}
                                            </Link>
                                        ) : (
                                            name
                                        )}
                                    </Typography>
                                    <Typography sx={{ flex: 1 }} color="text.secondary">
                                        {application.userConsentRequired ? t("thirdPartyApp") : t("internalApp")}
                                        {application.offlineAccess ? `, ${t("offlineAccess")}` : ""}
                                    </Typography>
                                    <Typography sx={{ flex: 1 }}>{application.inUse ? t("inUse") : t("notInUse")}</Typography>
                                </Stack>
                            </AccordionSummary>
                            <AccordionDetails>
                                <Stack spacing={1.5}>
                                    <Detail label={t("client")} value={application.clientId} />
                                    {application.description && <Detail label={t("description")} value={application.description} />}
                                    {application.effectiveUrl && <Detail label="URL" value={application.effectiveUrl.split('"').join("")} />}
                                    {application.consent && (
                                        <>
                                            <Typography variant="body2" color="text.secondary">
                                                {t("hasAccessTo")}
                                            </Typography>
                                            {application.consent.grantedScopes.map(scope => (
                                                <Typography key={scope.id}>
                                                    <CheckIcon fontSize="inherit" /> {t(scope.name as TFuncKey, { defaultValue: scope.displayText })}
                                                </Typography>
                                            ))}
                                            {application.tosUri && <Detail label={t("termsOfService")} value={application.tosUri} />}
                                            {application.policyUri && <Detail label={t("privacyPolicy")} value={application.policyUri} />}
                                            {application.logoUri && <img src={application.logoUri} alt="" style={{ maxWidth: 120 }} />}
                                            <Detail
                                                label={t("accessGrantedOn")}
                                                value={formatDate(new Date(application.consent.createdDate), context.environment.locale)}
                                            />
                                        </>
                                    )}
                                    {(application.consent || application.offlineAccess) && (
                                        <Stack spacing={1}>
                                            <ConfirmButton
                                                title={t("removeAccess")}
                                                message={t("removeModalMessage", { name: application.clientId })}
                                                confirmLabel={t("confirm")}
                                                cancelLabel={t("cancel")}
                                                color="error"
                                                onConfirm={() => removeConsent(application.clientId)}
                                            />
                                            <Typography variant="body2" color="text.secondary">
                                                <InfoOutlinedIcon fontSize="inherit" /> {t("infoMessage")}
                                            </Typography>
                                        </Stack>
                                    )}
                                </Stack>
                            </AccordionDetails>
                        </Accordion>
                    );
                })}
            </Stack>
        </Page>
    );
};

function Detail({ label: term, value }: { label: string; value: string }) {
    return (
        <Typography variant="body2">
            <strong>{term}: </strong>
            {value}
        </Typography>
    );
}

export default Applications;
