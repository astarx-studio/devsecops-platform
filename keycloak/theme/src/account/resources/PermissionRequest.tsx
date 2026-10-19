import { useState } from "react";
import Badge from "@mui/material/Badge";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import { useTranslation } from "react-i18next";
import { useEnvironment } from "../../shared/keycloak-ui-shared";
import { fetchPermission, updateRequest } from "../api";
import type { Permission, Resource } from "../api/representations";
import { useAccountAlerts } from "../utils/useAccountAlerts";

export const PermissionRequest = ({ resource, refresh }: { resource: Resource; refresh: () => void }) => {
    const { t } = useTranslation();
    const context = useEnvironment();
    const { addAlert, addError } = useAccountAlerts();
    const [open, setOpen] = useState(false);

    const approveDeny = async (shareRequest: Permission, approve = false) => {
        try {
            const permissions = await fetchPermission({ context }, resource._id);
            const current = permissions.find(permission => permission.username === shareRequest.username) || {
                scopes: [],
                username: shareRequest.username
            };
            await updateRequest(
                context,
                resource._id,
                current.username,
                approve ? [...(current.scopes as string[]), ...(shareRequest.scopes as string[])] : current.scopes
            );
            addAlert(t("shareSuccess"));
            setOpen(false);
            refresh();
        } catch (error) {
            addError("shareError", error);
        }
    };

    return (
        <>
            <IconButton aria-label={t("permissionRequest", { name: resource.name })} onClick={() => setOpen(true)}>
                <Badge badgeContent={resource.shareRequests?.length} color="primary">
                    <HowToRegIcon />
                </Badge>
            </IconButton>
            <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="md">
                <DialogTitle>{t("permissionRequest", { name: resource.name })}</DialogTitle>
                <DialogContent>
                    <Table size="small" aria-label={t("resources")}>
                        <TableHead>
                            <TableRow>
                                <TableCell>{t("requestor")}</TableCell>
                                <TableCell>{t("permissionRequests")}</TableCell>
                                <TableCell />
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {resource.shareRequests?.map(shareRequest => (
                                <TableRow key={shareRequest.username}>
                                    <TableCell>
                                        {shareRequest.firstName} {shareRequest.lastName} {shareRequest.lastName ? "" : shareRequest.username}
                                        <Typography variant="caption" display="block">
                                            {shareRequest.email}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Stack direction="row" spacing={0.5}>
                                            {shareRequest.scopes.map(scope => (
                                                <Chip key={String(scope)} size="small" label={String(scope)} />
                                            ))}
                                        </Stack>
                                    </TableCell>
                                    <TableCell>
                                        <Button onClick={() => approveDeny(shareRequest, true)}>{t("accept")}</Button>
                                        <Button color="error" onClick={() => approveDeny(shareRequest)}>
                                            {t("deny")}
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpen(false)}>{t("close")}</Button>
                </DialogActions>
            </Dialog>
        </>
    );
};
