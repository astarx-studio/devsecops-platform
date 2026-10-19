import { Fragment, useState } from "react";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { useTranslation } from "react-i18next";
import { useEnvironment } from "../../shared/keycloak-ui-shared";
import { fetchPermission, fetchResources, updatePermissions } from "../api";
import { getPermissionRequests } from "../api/methods";
import type { Links } from "../api/parse-links";
import type { Permission, Resource } from "../api/representations";
import { ConfirmButton } from "../components/ConfirmButton";
import { useAccountAlerts } from "../utils/useAccountAlerts";
import { usePromise } from "../utils/usePromise";
import { EditTheResource } from "./EditTheResource";
import { PermissionRequest } from "./PermissionRequest";
import { ResourceToolbar } from "./ResourceToolbar";
import { ShareTheResource } from "./ShareTheResource";
import { SharedWith } from "./SharedWith";

type PermissionDetail = {
    contextOpen?: boolean;
    rowOpen?: boolean;
    shareDialogOpen?: boolean;
    editDialogOpen?: boolean;
    permissions?: Permission[];
};

export const ResourcesTab = ({ isShared = false }: { isShared?: boolean }) => {
    const { t } = useTranslation();
    const context = useEnvironment();
    const { addAlert, addError } = useAccountAlerts();
    const [params, setParams] = useState<Record<string, string>>({
        first: "0",
        max: "5"
    });
    const [links, setLinks] = useState<Links | undefined>();
    const [resources, setResources] = useState<Resource[]>();
    const [details, setDetails] = useState<Record<string, PermissionDetail | undefined>>(
        {}
    );
    const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
    const [key, setKey] = useState(1);
    const refresh = () => setKey(current => current + 1);

    usePromise(
        async signal => {
            const result = await fetchResources({ signal, context }, params, isShared);
            if (!isShared) {
                await Promise.all(
                    result.data.map(async resource => {
                        resource.shareRequests = await getPermissionRequests(
                            resource._id,
                            { signal, context }
                        );
                    })
                );
            }
            return result;
        },
        ({ data, links: nextLinks }) => {
            setResources(data);
            setLinks(nextLinks);
        },
        [params, key]
    );

    if (!resources) {
        return <CircularProgress />;
    }

    const fetchPermissions = async (id: string): Promise<Permission[]> => {
        const existing = details[id]?.permissions;
        if (existing) return existing;
        return fetchPermission({ context }, id);
    };

    const removeShare = async (resource: Resource) => {
        try {
            const permissions = (await fetchPermissions(resource._id)).map(
                ({ username }) => ({ username, scopes: [] }) as Permission
            );
            await updatePermissions(context, resource._id, permissions);
            setDetails({});
            addAlert(t("unShareSuccess"));
        } catch (error) {
            addError("unShareError", error);
        }
    };

    const toggleOpen = async (
        id: string,
        field: keyof PermissionDetail,
        open: boolean
    ) => {
        const permissions = await fetchPermissions(id);
        setDetails({ ...details, [id]: { ...details[id], [field]: open, permissions } });
    };

    return (
        <>
            <ResourceToolbar
                onFilter={name => setParams({ ...params, name })}
                count={resources.length}
                first={parseInt(params.first)}
                max={parseInt(params.max)}
                onNextClick={() => setParams(links?.next || {})}
                onPreviousClick={() => setParams(links?.prev || {})}
                onPerPageSelect={(first, max) =>
                    setParams({ first: `${first}`, max: `${max}` })
                }
                hasNext={!!links?.next}
            />
            <Table aria-label={t("resources")} size="small">
                <TableHead>
                    <TableRow>
                        {!isShared && <TableCell />}
                        <TableCell>{t("resourceName")}</TableCell>
                        <TableCell>{t("application")}</TableCell>
                        <TableCell>
                            {isShared ? t("permissions") : t("permissionRequests")}
                        </TableCell>
                        {!isShared && <TableCell />}
                    </TableRow>
                </TableHead>
                <TableBody>
                    {resources.map((resource, index) => (
                        <Fragment key={resource._id}>
                            <TableRow>
                                {!isShared && (
                                    <TableCell>
                                        <IconButton
                                            aria-label={resource.name}
                                            data-testid={`expand-${resource.name}`}
                                            onClick={() =>
                                                toggleOpen(
                                                    resource._id,
                                                    "rowOpen",
                                                    !details[resource._id]?.rowOpen
                                                )
                                            }
                                        >
                                            {details[resource._id]?.rowOpen ? (
                                                <KeyboardArrowUpIcon />
                                            ) : (
                                                <KeyboardArrowDownIcon />
                                            )}
                                        </IconButton>
                                    </TableCell>
                                )}
                                <TableCell data-testid={`row[${index}].name`}>
                                    {resource.name}
                                </TableCell>
                                <TableCell>
                                    <Link href={resource.client.baseUrl}>
                                        {resource.client.name || resource.client.clientId}
                                    </Link>
                                </TableCell>
                                <TableCell>
                                    {isShared ? (
                                        <Stack
                                            direction="row"
                                            spacing={0.5}
                                            sx={{ flexWrap: "wrap" }}
                                        >
                                            {resource.scopes.map(scope => (
                                                <Chip
                                                    key={scope.name}
                                                    size="small"
                                                    label={
                                                        scope.displayName || scope.name
                                                    }
                                                />
                                            ))}
                                        </Stack>
                                    ) : (
                                        resource.shareRequests &&
                                        resource.shareRequests.length > 0 && (
                                            <PermissionRequest
                                                resource={resource}
                                                refresh={refresh}
                                            />
                                        )
                                    )}
                                    <ShareTheResource
                                        resource={resource}
                                        permissions={details[resource._id]?.permissions}
                                        open={
                                            details[resource._id]?.shareDialogOpen ||
                                            false
                                        }
                                        onClose={() => setDetails({})}
                                    />
                                    {details[resource._id]?.editDialogOpen && (
                                        <EditTheResource
                                            resource={resource}
                                            permissions={
                                                details[resource._id]?.permissions
                                            }
                                            onClose={() => setDetails({})}
                                        />
                                    )}
                                </TableCell>
                                {!isShared && (
                                    <TableCell>
                                        <Button
                                            data-testid={`share-${resource.name}`}
                                            onClick={() =>
                                                toggleOpen(
                                                    resource._id,
                                                    "shareDialogOpen",
                                                    true
                                                )
                                            }
                                        >
                                            {t("share")}
                                        </Button>
                                        <IconButton
                                            aria-label={t("edit")}
                                            onClick={event =>
                                                setMenu({
                                                    id: resource._id,
                                                    anchor: event.currentTarget
                                                })
                                            }
                                        >
                                            <MoreVertIcon />
                                        </IconButton>
                                    </TableCell>
                                )}
                            </TableRow>
                            {!isShared && details[resource._id]?.rowOpen && (
                                <TableRow>
                                    <TableCell colSpan={5}>
                                        <SharedWith
                                            permissions={
                                                details[resource._id]?.permissions
                                            }
                                        />
                                    </TableCell>
                                </TableRow>
                            )}
                        </Fragment>
                    ))}
                </TableBody>
            </Table>
            <Menu open={!!menu} anchorEl={menu?.anchor} onClose={() => setMenu(null)}>
                <MenuItem
                    disabled={!details[menu?.id || ""]?.permissions?.length}
                    onClick={() => {
                        if (menu) void toggleOpen(menu.id, "editDialogOpen", true);
                        setMenu(null);
                    }}
                >
                    {t("edit")}
                </MenuItem>
                <MenuItem
                    disabled={!details[menu?.id || ""]?.permissions?.length}
                    onClick={() => setMenu(null)}
                >
                    {menu && (
                        <ConfirmButton
                            title={t("unShare")}
                            message={t("unShareAllConfirm")}
                            confirmLabel={t("confirm")}
                            cancelLabel={t("cancel")}
                            color="error"
                            variant="text"
                            disabled={!details[menu.id]?.permissions?.length}
                            onConfirm={() =>
                                removeShare(
                                    resources.find(resource => resource._id === menu.id)!
                                )
                            }
                        />
                    )}
                </MenuItem>
            </Menu>
        </>
    );
};
