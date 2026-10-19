import { useState } from "react";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import { useTranslation } from "react-i18next";
import { useEnvironment } from "../../shared/keycloak-ui-shared";
import { getGroups } from "../api/methods";
import type { Group } from "../api/representations";
import { Page } from "../components/page/Page";
import { usePromise } from "../utils/usePromise";

export const Groups = () => {
    const { t } = useTranslation();
    const context = useEnvironment();
    const [groups, setGroups] = useState<Group[]>([]);
    const [directMembership, setDirectMembership] = useState(false);

    usePromise(
        signal => getGroups({ signal, context }),
        next => {
            if (!directMembership) {
                next.forEach(group => getParents(group, next, next.map(({ path }) => path)));
            }
            setGroups(next);
        },
        [directMembership]
    );

    return (
        <Page title={t("groups")} description={t("groupDescriptionLabel")}>
            <FormControlLabel
                control={
                    <Checkbox
                        id="directMembership-checkbox"
                        data-testid="directMembership-checkbox"
                        checked={directMembership}
                        onChange={(_, checked) => setDirectMembership(checked)}
                    />
                }
                label={t("directMembership")}
            />
            <Table id="groups-list" aria-label={t("groups")} size="small">
                <TableHead>
                    <TableRow>
                        <TableCell>{t("name")}</TableCell>
                        <TableCell>{t("path")}</TableCell>
                        <TableCell>{t("directMembership")}</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {groups.map((group, index) => (
                        <TableRow key={`${group.path}-${index}`} id={`${index}-group`}>
                            <TableCell data-testid={`group[${index}].name`}>{group.name}</TableCell>
                            <TableCell>{group.path}</TableCell>
                            <TableCell>
                                <Checkbox checked={group.id != null} disabled />
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </Page>
    );
};

function getParents(group: Group, groups: Group[], groupsPaths: string[]) {
    const parentPath = group.path.slice(0, group.path.lastIndexOf("/"));
    if (parentPath && !groupsPaths.includes(parentPath)) {
        const parent = { name: parentPath.slice(parentPath.lastIndexOf("/") + 1), path: parentPath };
        groups.push(parent);
        groupsPaths.push(parentPath);
        getParents(parent, groups, groupsPaths);
    }
}

export default Groups;
