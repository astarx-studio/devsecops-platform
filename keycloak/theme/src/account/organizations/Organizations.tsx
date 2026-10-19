import { useState } from "react";
import type OrganizationRepresentation from "@keycloak/keycloak-admin-client/lib/defs/organizationRepresentation";
import CircularProgress from "@mui/material/CircularProgress";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { useEnvironment } from "../../shared/keycloak-ui-shared";
import type { AccountEnvironment } from "..";
import { getUserOrganizations } from "../api/methods";
import { Page } from "../components/page/Page";
import { usePromise } from "../utils/usePromise";

export const Organizations = () => {
    const { t } = useTranslation();
    const context = useEnvironment<AccountEnvironment>();
    const [userOrgs, setUserOrgs] = useState<OrganizationRepresentation[]>();

    usePromise(signal => getUserOrganizations({ signal, context }), setUserOrgs);

    if (!userOrgs) {
        return <CircularProgress />;
    }

    return (
        <Page title={t("organizations")} description={t("organizationDescription")}>
            {userOrgs.length === 0 ? (
                <Typography color="text.secondary">{t("emptyUserOrganizationsInstructions")}</Typography>
            ) : (
                <Table size="small" aria-label={t("organizations")}>
                    <TableHead>
                        <TableRow>
                            <TableCell>{t("name")}</TableCell>
                            <TableCell>{t("description")}</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {userOrgs.map(organization => (
                            <TableRow key={organization.id || organization.name}>
                                <TableCell>{organization.name}</TableCell>
                                <TableCell>{organization.description}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </Page>
    );
};

export default Organizations;
