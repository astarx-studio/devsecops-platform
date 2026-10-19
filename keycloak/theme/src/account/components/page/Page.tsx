import type { PropsWithChildren } from "react";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

type PageProps = {
    title: string;
    description: string;
};

export const Page = ({ title, description, children }: PropsWithChildren<PageProps>) => {
    return (
        <Stack spacing={3}>
            <Stack spacing={0.5}>
                <Typography variant="h4" component="h1" data-testid="page-heading">
                    {title}
                </Typography>
                <Typography color="text.secondary">{description}</Typography>
            </Stack>
            <Paper elevation={2} sx={{ p: { xs: 2, sm: 3 } }}>
                {children}
            </Paper>
        </Stack>
    );
};
