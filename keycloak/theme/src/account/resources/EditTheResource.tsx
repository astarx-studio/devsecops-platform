import { useEffect } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useFieldArray, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useEnvironment } from "../../shared/keycloak-ui-shared";
import { updatePermissions } from "../api";
import type { Permission, Resource } from "../api/representations";
import { useAccountAlerts } from "../utils/useAccountAlerts";

type FormValues = { permissions: Permission[] };

export const EditTheResource = ({
    resource,
    permissions,
    onClose
}: {
    resource: Resource;
    permissions?: Permission[];
    onClose: () => void;
}) => {
    const { t } = useTranslation();
    const context = useEnvironment();
    const { addAlert, addError } = useAccountAlerts();
    const form = useForm<FormValues>({ defaultValues: { permissions: permissions || [] } });
    const { control, reset, handleSubmit } = form;
    const { fields } = useFieldArray({ control, name: "permissions" });

    useEffect(() => {
        reset({ permissions });
    }, [permissions, reset]);

    const editShares = async ({ permissions: next }: FormValues) => {
        try {
            await Promise.all(next.map(permission => updatePermissions(context, resource._id, [permission])));
            addAlert(t("updateSuccess"));
            onClose();
        } catch (error) {
            addError("updateError", error);
        }
    };

    return (
        <Dialog open onClose={onClose} fullWidth>
            <DialogTitle>{t("editTheResource", { name: resource.name })}</DialogTitle>
            <DialogContent>
                <Stack component="form" id="edit-form" spacing={2} sx={{ pt: 1 }} onSubmit={handleSubmit(editShares)}>
                    {fields.map((permission, index) => (
                        <Stack key={permission.id} spacing={1}>
                            <TextField label={t("user")} value={form.watch(`permissions.${index}.username`) || ""} disabled />
                            <Autocomplete
                                multiple
                                options={resource.scopes.map(scope => scope.name)}
                                defaultValue={(permission.scopes as string[]) || []}
                                getOptionLabel={option => resource.scopes.find(scope => scope.name === option)?.displayName || option}
                                onChange={(_, value) => form.setValue(`permissions.${index}.scopes`, value)}
                                renderInput={params => <TextField {...params} label={t("permissions")} />}
                            />
                        </Stack>
                    ))}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button id="done" variant="contained" type="submit" form="edit-form">
                    {t("done")}
                </Button>
            </DialogActions>
        </Dialog>
    );
};
