import { useState } from "react";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useTranslation } from "react-i18next";

type ResourceToolbarProps = {
    onFilter: (nameFilter: string) => void;
    count: number;
    first: number;
    max: number;
    onNextClick: (page: number) => void;
    onPreviousClick: (page: number) => void;
    onPerPageSelect: (max: number, first: number) => void;
    hasNext: boolean;
};

export const ResourceToolbar = ({ first, max, onNextClick, onPreviousClick, onFilter, hasNext }: ResourceToolbarProps) => {
    const { t } = useTranslation();
    const [nameFilter, setNameFilter] = useState("");
    const page = Math.round(first / max) + 1;

    return (
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, my: 2 }}>
            <TextField
                size="small"
                placeholder={t("filterByName")}
                aria-label={t("filterByName")}
                value={nameFilter}
                onChange={event => setNameFilter(event.target.value)}
                onKeyDown={event => {
                    if (event.key === "Enter") onFilter(nameFilter);
                }}
            />
            <Button onClick={() => onFilter(nameFilter)}>{t("search", { defaultValue: "Search" })}</Button>
            <Button disabled={page <= 1} onClick={() => onPreviousClick((page - 2) * max)}>
                {t("previous", { defaultValue: "Previous" })}
            </Button>
            <span>{page}</span>
            <Button disabled={!hasNext} onClick={() => onNextClick(page * max)}>
                {t("next", { defaultValue: "Next" })}
            </Button>
        </Stack>
    );
};
