import { useEffect } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useEnvironment } from "../../shared/keycloak-ui-shared";
import { updateRequest } from "../api";
import type { Permission, Resource } from "../api/representations";
import { useAccountAlerts } from "../utils/useAccountAlerts";
import { SharedWith } from "./SharedWith";

type FormValues = {
    permissions: string[];
    usernames: { value: string }[];
};

export const ShareTheResource = ({
    resource,
    permissions,
    open,
    onClose
}: {
    resource: Resource;
    permissions?: Permission[];
    open: boolean;
    onClose: () => void;
}) => {
    const { t } = useTranslation();
    const context = useEnvironment();
    const { addAlert, addError } = useAccountAlerts();
    const form = useForm<FormValues>({ defaultValues: { permissions: [], usernames: [{ value: "" }] } });
    const { control, register, reset, handleSubmit, setError, clearErrors, formState } = form;
    const { fields, append, remove } = useFieldArray({ control, name: "usernames" });
    const watchFields = useWatch({ control, name: "usernames", defaultValue: [] });
    const isDisabled = watchFields.every(({ value }) => value.trim().length === 0);

    useEffect(() => {
        if (fields.length === 0) append({ value: "" });
    }, [append, fields.length]);

    const addShare = async ({ usernames, permissions: scopes }: FormValues) => {
        try {
            await Promise.all(
                usernames.filter(({ value }) => value !== "").map(({ value: username }) => updateRequest(context, resource._id, username, scopes))
            );
            addAlert(t("shareSuccess"));
            onClose();
        } catch (error) {
            addError("shareError", error);
        }
        reset({ permissions: [], usernames: [{ value: "" }] });
    };

    return (
        <Dialog open={open} onClose={onClose} fullWidth>
            <DialogTitle>{t("shareTheResource", { name: resource.name })}</DialogTitle>
            <DialogContent>
                <Stack component="form" id="share-form" spacing={2} sx={{ pt: 1 }} onSubmit={handleSubmit(addShare)}>
                    <Stack direction="row" spacing={1}>
                        <TextField
                            id="users"
                            data-testid="users"
                            fullWidth
                            placeholder={t("usernamePlaceholder")}
                            error={!!formState.errors.usernames}
                            helperText={formState.errors.usernames?.message}
                            {...register(`usernames.${Math.max(fields.length - 1, 0)}.value`, {
                                validate: async () => {
                                    const names = fields.map(field => field.value).filter(Boolean);
                                    const already = permissions?.flatMap(permission => [permission.username, permission.email]) ?? [];
                                    const shared = names.some(name => already.includes(name));
                                    if (names.length === 0 || shared) {
                                        setError("usernames", { message: names.length === 0 ? t("required") : t("resourceAlreadyShared") });
                                        return names.length > 0 && !shared;
                                    }
                                    clearErrors("usernames");
                                    return true;
                                }
                            })}
                        />
                        <Button data-testid="add" variant="contained" disabled={isDisabled} onClick={() => append({ value: "" })}>
                            {t("add")}
                        </Button>
                    </Stack>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                        {fields.map(
                            (field, index) =>
                                index !== fields.length - 1 && (
                                    <Chip key={field.id} label={field.value} onDelete={() => remove(index)} />
                                )
                        )}
                    </Stack>
                    <Autocomplete
                        multiple
                        options={resource.scopes.map(scope => scope.name)}
                        getOptionLabel={option => resource.scopes.find(scope => scope.name === option)?.displayName || option}
                        onChange={(_, value) => form.setValue("permissions", value)}
                        renderInput={params => <TextField {...params} label={t("permissions")} />}
                    />
                    <SharedWith permissions={permissions} />
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>{t("cancel")}</Button>
                <Button data-testid="done" variant="contained" type="submit" form="share-form">
                    {t("done")}
                </Button>
            </DialogActions>
        </Dialog>
    );
};
